import { spawn } from "node:child_process";

// Lightweight "is this frame reachable on the network" check via ICMP ping.
// A deep-sleeping e-paper frame still answers pings (its WiFi chip does), even when
// its HTTP server is asleep — so this reflects "powered and on the network", which is
// what the Devices "online" badge means.

const TTL_MS = 20_000; // reuse a ping result for this long
const cache = new Map<string, { ok: boolean; ts: number }>();
const inflight = new Map<string, Promise<boolean>>();

// Strip scheme and port/path so we ping a bare host (e.g. "photoframe-1.local").
function hostOnly(host: string): string {
  return host.replace(/^https?:\/\//, "").replace(/[:/].*$/, "").trim();
}

function pingOnce(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    // -c 1 = one packet, -w/-W = 2s deadline. Linux uses -w (deadline), -W (per-reply timeout).
    const p = spawn("ping", ["-c", "1", "-w", "2", host], { stdio: "ignore" });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

// Returns current reachability, pinging if the cached value is stale. Awaitable so the
// /devices response is accurate on each poll; concurrent calls for the same host share one ping.
export function isReachable(rawHost: string): Promise<boolean> {
  const host = hostOnly(rawHost);
  if (!host) return Promise.resolve(false);
  const c = cache.get(host);
  if (c && Date.now() - c.ts < TTL_MS) return Promise.resolve(c.ok);
  const existing = inflight.get(host);
  if (existing) return existing;
  const pr = pingOnce(host).then((ok) => {
    cache.set(host, { ok, ts: Date.now() });
    inflight.delete(host);
    return ok;
  });
  inflight.set(host, pr);
  return pr;
}
