import { useEffect, useRef, useState } from "react";
import { Usb, X, Eraser, RotateCcw, Check } from "lucide-react";
import { connectSerial, serialSupported, parseHostname, type SerialSession } from "../serial.ts";
import { Button } from "./ui.tsx";

export function SerialConsole({ onHostname }: { onHostname?: (host: string) => void }) {
  const [session, setSession] = useState<SerialSession | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const bufRef = useRef("");
  const boxRef = useRef<HTMLPreElement>(null);
  const supported = serialSupported();

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [text]);
  useEffect(() => () => void session?.close(), [session]);

  function handleData(chunk: string) {
    setText((prev) => (prev + chunk).slice(-40000));
    bufRef.current = (bufRef.current + chunk).slice(-4000);
    const host = parseHostname(bufRef.current);
    if (host) setDetected(host);
  }

  async function connect() {
    setErr(null);
    try {
      setSession(await connectSerial(handleData));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function disconnect() {
    await session?.close();
    setSession(null);
  }

  if (!supported) {
    return (
      <p className="text-sm text-amber-600">
        USB serial needs Chrome or Edge over <code>https</code> or <code>localhost</code>.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {session ? (
          <>
            <Button variant="ghost" onClick={disconnect}>
              <X size={14} /> Disconnect
            </Button>
            <Button variant="ghost" onClick={() => session.reboot()}>
              <RotateCcw size={14} /> Reboot
            </Button>
          </>
        ) : (
          <Button onClick={connect}>
            <Usb size={14} /> Connect &amp; view log
          </Button>
        )}
        <Button variant="ghost" onClick={() => setText("")}>
          <Eraser size={14} /> Clear
        </Button>
      </div>

      {detected && (
        <div className="flex items-center gap-2 mb-2 text-sm rounded-lg bg-green-500/10 px-2.5 py-1.5">
          <Check size={14} className="text-green-500" />
          Detected <code className="text-[var(--text)]">{detected}</code>
          {onHostname && (
            <Button onClick={() => onHostname(detected)} className="ml-auto">
              Use as host
            </Button>
          )}
        </div>
      )}

      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
      <pre
        ref={boxRef}
        className="h-56 overflow-auto rounded-lg bg-black text-green-300 text-[11px] leading-relaxed p-3 font-mono whitespace-pre-wrap"
      >
        {text || "Not connected. Click Connect, pick the frame's USB serial port, then Reboot to read its hostname."}
      </pre>
    </div>
  );
}
