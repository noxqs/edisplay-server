// Drives "simulated" devices server-side so group behaviour can be tested without
// real frames: on each tick every simulated device picks an image (via its profile),
// records the fetch, drains its battery, and logs usage — just like a real frame.
import type { DeviceRepo } from "./repositories/devices.js";
import type { UsageRepo } from "./repositories/usage.js";
import type { Selection } from "./selection.js";

export class Simulator {
  private timer?: ReturnType<typeof setInterval>;
  private ticks = 0;

  constructor(
    private readonly devices: DeviceRepo,
    private readonly selection: Selection,
    private readonly usage: UsageRepo,
    private readonly tickMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.warn("[simulator] tick failed:", err));
    }, this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    this.ticks++;
    const now = Date.now();
    for (const d of this.devices.listSimulated()) {
      // Honor the device's rotate cadence (same as real frames) instead of every tick.
      const everyMs = Math.max(1, d.rotate_every_min ?? 60) * 60_000;
      if (d.last_asset_id && now - (d.last_rotation_at ?? 0) < everyMs) continue;
      const profile = this.selection.resolveProfile(d);
      let assetId: string;
      try {
        assetId = await this.selection.nextAsset(profile);
      } catch {
        continue; // no albums available for this device yet
      }
      const battery = nextBattery(d.battery_pct);
      this.devices.recordFetch(d.id, {
        assetId,
        rotatedAt: now,
        batteryPct: battery,
        width: d.width ?? 1200,
        height: d.height ?? 1600,
        orientation: d.orientation ?? "portrait",
        firmware: d.firmware ?? "sim-1.0",
      });
      // Mimic a real frame handing over battery/firmware while awake (stamps last_telemetry_at).
      this.devices.recordTelemetry(d.id, { batteryPct: battery, firmware: d.firmware ?? "sim-1.0" });
      this.usage.log({ deviceId: d.id, type: "show", assetId });
      if (this.ticks % 3 === 0) this.usage.log({ deviceId: d.id, type: "battery", batteryPct: battery });
    }
  }
}

function nextBattery(current: number | null): number {
  const v = current ?? 100;
  return v <= 12 ? 100 : Math.round((v - 2) * 10) / 10;
}
