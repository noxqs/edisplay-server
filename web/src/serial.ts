// Minimal Web Serial helper for the frame's USB log (read-only). Also a best-effort reboot
// via the ESP DTR/RTS reset lines. Chromium-only; requires a secure context.
import { ImprovSerial } from "improv-wifi-serial-sdk/dist/serial.js";
import { ImprovSerialCurrentState } from "improv-wifi-serial-sdk/dist/const.js";

export interface SerialSession {
  close: () => Promise<void>;
  reboot: () => Promise<void>;
}

export interface ImprovProbe {
  /** True if the firmware answers the Improv-Serial protocol over USB. */
  supported: boolean;
  /** When supported: is the frame already on Wi-Fi? */
  provisioned?: boolean;
  /** When provisioned: the device-reported URL to reach it. */
  nextUrl?: string | null;
  /** Reason it's unsupported / any error detail. */
  detail?: string;
}

/**
 * Ask the plugged-in board (over USB) whether it speaks Improv-Serial — i.e. whether
 * Wi-Fi can be set over USB without touching the firmware. Resolves quickly either way.
 */
export async function probeImprovSerial(): Promise<ImprovProbe> {
  if (!serialSupported()) {
    return { supported: false, detail: "Web Serial needs Chrome/Edge over https or localhost." };
  }
  await closeAllSerialSessions(); // free the port if our log/wake button holds it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serial = (navigator as any).serial;
  const port = await serial.requestPort();
  if (!port.readable) await port.open({ baudRate: 115200 });
  const improv = new ImprovSerial(port, console);
  try {
    await improv.initialize(3000); // rejects "not detected" if no Improv
    const provisioned = improv.state === ImprovSerialCurrentState.PROVISIONED;
    const nextUrl = improv.nextUrl ?? null;
    await Promise.race([improv.close(), sleep(1500)]);
    try { await port.close(); } catch { /* reader may still hold it briefly */ }
    return { supported: true, provisioned, nextUrl };
  } catch (e) {
    await Promise.race([improv.close().catch(() => {}), sleep(1500)]);
    try { await port.close(); } catch { /* ignore */ }
    return { supported: false, detail: (e as Error).message };
  }
}

export function serialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext;
}

// A Web Serial port can only be open()'d once. We track our own open sessions so that
// before handing a port to esp-web-tools (flashing) we can release it — otherwise the
// flasher hits "The port is already open".
const activeSessions = new Set<SerialSession>();

export async function closeAllSerialSessions(): Promise<void> {
  await Promise.all([...activeSessions].map((s) => s.close().catch(() => {})));
}

/** Pull the mDNS hostname out of the boot log, e.g. "accessible at: http://photoframe-office-1.local". */
export function parseHostname(text: string): string | null {
  const m = /accessible at:\s*https?:\/\/([A-Za-z0-9-]+\.local)/i.exec(text) || /hostname:\s*([A-Za-z0-9-]+\.local)/i.exec(text);
  return m ? m[1] : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function connectSerial(onData: (chunk: string) => void): Promise<SerialSession> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serial = (navigator as any).serial;
  const port = await serial.requestPort();

  // `port.readable` is non-null only when the port is already open (e.g. a stale session
  // left it open after a hot reload). Reuse it instead of re-opening (which would throw
  // "The port is already open").
  if (!port.readable) {
    await port.open({ baudRate: 115200 });
  }
  if (!port.readable || port.readable.locked) {
    throw new Error("The serial port is busy from a previous session. Reload the page (Ctrl+Shift+R) and connect again.");
  }

  let keep = true;
  const readable: ReadableStream<string> = port.readable.pipeThrough(new TextDecoderStream());
  const reader = readable.getReader();

  (async () => {
    try {
      while (keep) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) onData(value);
      }
    } catch {
      /* port closed */
    }
  })();

  const session: SerialSession = {
    reboot: async () => {
      // Classic ESP reset: assert EN low via RTS, then release to run mode.
      try {
        await port.setSignals({ dataTerminalReady: false, requestToSend: true });
        await sleep(120);
        await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      } catch {
        /* board may ignore DTR/RTS — physical reset still works */
      }
    },
    close: async () => {
      activeSessions.delete(session);
      keep = false;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      try {
        await port.close();
      } catch {
        /* ignore */
      }
    },
  };
  activeSessions.add(session);
  return session;
}
