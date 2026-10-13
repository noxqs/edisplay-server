// All photoframe device management, surfaced on the Dashboard as a compact list.
// Each row summarises a frame; "Edit" expands the full editor (assignments + the
// over-WiFi/USB panel). The three add/flash actions live in the header.
import { useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Pencil, MonitorSmartphone, BatteryMedium, Cpu, Usb, RadioTower, RotateCw, Zap, Wifi, ImagePlus, SkipForward, X,
} from "lucide-react";
import {
  apiGet, apiSend, thumbUrl, clockTime,
  type Device, type Schedule, type Group,
} from "../api/client.ts";
import { serialSupported, connectSerial, probeImprovSerial, type ImprovProbe } from "../serial.ts";
import { Card, Button, Badge, Modal } from "./ui.tsx";
import { FlashButton } from "./FlashButton.tsx";
import { SerialConsole } from "./SerialConsole.tsx";

export function DeviceManager() {
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => apiGet<Device[]>("/api/devices"), refetchInterval: 15000 });
  const schedules = useQuery({ queryKey: ["schedules"], queryFn: () => apiGet<Schedule[]>("/api/schedules") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => apiGet<Group[]>("/api/groups") });

  const [modal, setModal] = useState<"physical" | "simulated" | "flash" | null>(null);
  const [waking, setWaking] = useState(false);
  const list = devices.data ?? [];

  // Reset whichever board is plugged into this computer over USB (ESP DTR/RTS toggle).
  // Browser-side and global — it prompts for the serial port, pulses reset, then releases it.
  async function wakeUsb() {
    if (!serialSupported()) {
      alert("USB wake needs Web Serial (Chrome/Edge over https or localhost).");
      return;
    }
    setWaking(true);
    try {
      const session = await connectSerial(() => {});
      await session.reboot();
      await session.close();
    } catch {
      /* user cancelled the port picker, or the board ignored reset */
    } finally {
      setWaking(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="font-semibold">Frames</h2>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setModal("physical")}>
            <Plus size={15} /> Add physical
          </Button>
          <Button variant="ghost" onClick={() => setModal("simulated")}>
            <Cpu size={15} /> Add simulated
          </Button>
          <Button variant="ghost" onClick={() => setModal("flash")}>
            <Usb size={15} /> Flash device
          </Button>
          <Button variant="ghost" onClick={wakeUsb} disabled={waking}>
            <Zap size={15} className={waking ? "animate-pulse" : ""} /> Wake USB device
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <Card className="flex flex-col items-center text-center py-10 border-dashed">
          <MonitorSmartphone className="text-[var(--muted)] mb-2" size={28} />
          <div className="font-medium">No frames yet</div>
          <p className="text-sm text-[var(--muted)] mt-1">Use the buttons above to add a real or simulated frame.</p>
        </Card>
      ) : (
        <div className="rounded-xl bg-[var(--panel)] divide-y divide-[var(--border)]">
          {list.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              schedules={schedules.data ?? []}
              groups={groups.data ?? []}
            />
          ))}
        </div>
      )}

      {(modal === "physical" || modal === "simulated") && (
        <AddFrameModal simulated={modal === "simulated"} onClose={() => setModal(null)} />
      )}
      {modal === "flash" && <FlashModal onClose={() => setModal(null)} />}
    </div>
  );
}

// Rotate cadence is stored in minutes; show it in hours when it divides evenly.
function rotateLabel(minutes: number | null | undefined): string {
  const m = Number(minutes ?? 60);
  if (!Number.isFinite(m) || m <= 0) return "n/a";
  if (m >= 60 && m % 60 === 0) {
    const h = m / 60;
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  return `${m} min`;
}

const ROTATE_MAX_MINUTES = 7 * 24 * 60; // 1 week; matches the server clamp

// Number field + min/hour unit picker, committing on blur / Enter / unit change.
function RotateEveryInput({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const asHours = minutes >= 60 && minutes % 60 === 0;
  const [unit, setUnit] = useState<"min" | "hour">(asHours ? "hour" : "min");
  const [value, setValue] = useState(String(asHours ? minutes / 60 : minutes));

  // Follow server-side changes (e.g. another tab) while not mid-edit.
  useEffect(() => {
    const h = minutes >= 60 && minutes % 60 === 0;
    setUnit(h ? "hour" : "min");
    setValue(String(h ? minutes / 60 : minutes));
  }, [minutes]);

  const commit = (raw: string, u: "min" | "hour") => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n <= 0) { // reject junk: fall back to the stored value
      const h = minutes >= 60 && minutes % 60 === 0;
      setUnit(h ? "hour" : "min");
      setValue(String(h ? minutes / 60 : minutes));
      return;
    }
    const total = Math.min(ROTATE_MAX_MINUTES, u === "hour" ? n * 60 : n);
    setValue(String(u === "hour" ? total / 60 : total));
    if (total !== minutes) onChange(total);
  };

  return (
    <span className="flex items-center gap-1">
      every
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value, unit)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-16 rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm text-[var(--text)]"
      />
      <select
        value={unit}
        onChange={(e) => { const u = e.target.value as "min" | "hour"; setUnit(u); commit(value, u); }}
        className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm text-[var(--text)]"
      >
        <option value="min">min</option>
        <option value="hour">hour</option>
      </select>
    </span>
  );
}

// epaper-image-convert processing presets. Firmware/convert name is "grayscale"; shown as "greyscale".
const PRESET_OPTIONS = [
  { value: "balanced", label: "balanced" },
  { value: "dynamic", label: "dynamic" },
  { value: "vivid", label: "vivid" },
  { value: "soft", label: "soft" },
  { value: "grayscale", label: "greyscale" },
];

function Thumb({
  assetId, label, highlight, onOpen,
}: {
  assetId: string | null; label: string; highlight?: boolean; onOpen?: (assetId: string, label: string) => void;
}) {
  const clickable = !!assetId && !!onOpen;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={() => assetId && onOpen?.(assetId, label)}
        disabled={!clickable}
        title={clickable ? "Click to enlarge" : undefined}
        className={`w-12 h-16 rounded-md bg-[var(--panel-muted)] overflow-hidden flex items-center justify-center ${highlight ? "ring-2 ring-blue-500" : ""} ${clickable ? "cursor-zoom-in hover:opacity-80 transition-opacity" : ""}`}
      >
        {assetId ? (
          <img src={thumbUrl(assetId)} alt="" className="w-full h-full object-cover" />
        ) : (
          <MonitorSmartphone className="text-[var(--muted)]" size={18} />
        )}
      </button>
      <span className={`text-[10px] ${highlight ? "text-blue-500" : "text-[var(--muted)]"}`}>{label}</span>
    </div>
  );
}

function ImageModal({ assetId, label, onClose }: { assetId: string; label: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6" onClick={onClose}>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          src={`${thumbUrl(assetId)}?size=preview`}
          alt=""
          className="max-w-[90vw] max-h-[88vh] rounded-lg object-contain shadow-2xl"
        />
        <span className="absolute top-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded capitalize">{label}</span>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function DeviceRow({
  device: d, schedules, groups,
}: {
  device: Device; schedules: Schedule[]; groups: Group[];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<{ assetId: string; label: string } | null>(null);
  // Which row action's status to show inline (left of the buttons).
  const [lastAction, setLastAction] = useState<"rotate" | "showNext" | "newImage" | "ping" | null>(null);

  const remove = useMutation({
    mutationFn: () => apiSend("DELETE", `/api/devices/${d.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
  // Custom fetch (not apiSend) so we can surface the server's message, not just the status.
  const rotate = useMutation({
    mutationFn: async (): Promise<{ message?: string; reachable?: boolean }> => {
      const res = await fetch(`/api/devices/${d.id}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
  });
  const ping = useMutation({
    mutationFn: async (): Promise<{ reachable: boolean; batteryPct: number | null; batteryMv: number | null }> => {
      const res = await fetch(`/api/devices/${d.id}/ping`);
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    // Pull pinged-in battery/firmware into the row.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
  const newImage = useMutation({
    mutationFn: async (): Promise<{ message?: string; reachable?: boolean }> => {
      const res = await fetch(`/api/devices/${d.id}/next-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
  const showNext = useMutation({
    mutationFn: async (): Promise<{ message?: string; reachable?: boolean }> => {
      const res = await fetch(`/api/devices/${d.id}/show-next`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });

  // Compact inline status for the last-clicked action.
  const status: { text: string; tone: string } | null =
    lastAction === "rotate" && (rotate.isPending || rotate.isSuccess || rotate.isError)
      ? rotate.isPending
        ? { text: "sending…", tone: "text-[var(--muted)]" }
        : rotate.isError
          ? { text: `✗ ${(rotate.error as Error).message}`, tone: "text-red-500" }
          : { text: rotate.data?.message ?? "sent", tone: rotate.data?.reachable === false ? "text-amber-600" : "text-green-600" }
      : lastAction === "newImage" && (newImage.isPending || newImage.isSuccess || newImage.isError)
        ? newImage.isPending
          ? { text: "creating next image…", tone: "text-[var(--muted)]" }
          : newImage.isError
            ? { text: `✗ ${(newImage.error as Error).message}`, tone: "text-red-500" }
            : { text: newImage.data?.message ?? "next image ready", tone: "text-green-600" }
      : lastAction === "showNext" && (showNext.isPending || showNext.isSuccess || showNext.isError)
        ? showNext.isPending
          ? { text: "showing next…", tone: "text-[var(--muted)]" }
          : showNext.isError
            ? { text: `✗ ${(showNext.error as Error).message}`, tone: "text-red-500" }
            : { text: showNext.data?.message ?? "showing next", tone: showNext.data?.reachable === false ? "text-amber-600" : "text-green-600" }
      : lastAction === "ping" && (ping.isPending || ping.isSuccess || ping.isError)
        ? ping.isPending
          ? { text: "pinging…", tone: "text-[var(--muted)]" }
          : ping.isError
            ? { text: `✗ ${(ping.error as Error).message}`, tone: "text-red-500" }
            : ping.data?.reachable
              ? {
                  text:
                    ping.data.batteryPct != null
                      ? `✓ up · battery ${Math.round(ping.data.batteryPct)}%${ping.data.batteryMv != null ? ` (${(ping.data.batteryMv / 1000).toFixed(2)}V)` : ""}`
                      : "✓ up (reachable)",
                  tone: "text-green-600",
                }
              : { text: "✗ no reply (asleep?)", tone: "text-amber-600" }
        : null;

  const groupName = groups.find((g) => g.id === d.group_id)?.name ?? "none";
  const scheduleName = schedules.find((s) => s.id === d.schedule_id)?.name ?? "none";
  const imagePath = `/d/${d.id}.png`;
  const token = d.hasAccessToken ? d.accessTokenMasked ?? "set" : "none";
  const hostUrl = d.host ? (/^https?:\/\//.test(d.host) ? d.host : `http://${d.host}`) : null;

  return (
    <div className="px-3 py-2.5">
      <div className="flex gap-3 items-start">
        <div className="flex gap-1 shrink-0">
          <Thumb assetId={d.last_asset_id} label="now" onOpen={(a, l) => setPreview({ assetId: a, label: l })} />
          {d.next_asset_id && <Thumb assetId={d.next_asset_id} label="next" highlight onOpen={(a, l) => setPreview({ assetId: a, label: l })} />}
        </div>

        <div className="flex-1 min-w-0">
          {/* Line 1: name + status badges */}
          <div className="flex items-center gap-2">
            <span className="font-medium truncate shrink min-w-0">{d.name}</span>
            <Badge tone={d.online ? "green" : "slate"}>{d.online ? "online" : "offline"}</Badge>
            <Badge tone={d.simulated ? "blue" : "slate"}>{d.simulated ? "simulated" : "physical"}</Badge>
            {/* Inline status fills the open middle space (truncates only at the real edge). */}
            {status ? (
              <span className={`flex-1 min-w-0 text-right truncate text-[11px] ${status.tone}`} title={status.text}>
                {status.text}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => { setLastAction("rotate"); rotate.mutate(); }}
                disabled={rotate.isPending}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                title="Re-send the current image to the frame"
              >
                <RotateCw size={15} className={rotate.isPending ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => { setLastAction("showNext"); showNext.mutate(); }}
                disabled={showNext.isPending}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                title="Show next: send the staged next image to the frame and pre-create the following one"
              >
                <SkipForward size={15} className={showNext.isPending ? "animate-pulse" : ""} />
              </button>
              <button
                onClick={() => { setLastAction("newImage"); newImage.mutate(); }}
                disabled={newImage.isPending}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                title="Pre-create the next image (staged on the server; press Show next to send it)"
              >
                <ImagePlus size={15} className={newImage.isPending ? "animate-pulse" : ""} />
              </button>
              <button
                onClick={() => { setLastAction("ping"); ping.mutate(); }}
                disabled={ping.isPending}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                title="Ping the frame (works even in deep sleep)"
              >
                <Wifi size={15} className={ping.isPending ? "animate-pulse" : ""} />
              </button>
              <button
                onClick={() => setEditing((e) => !e)}
                className={`p-1 rounded ${editing ? "text-blue-500" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                title="Edit"
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => { if (confirm(`Delete frame "${d.name}"?`)) remove.mutate(); }}
                className="p-1 rounded text-[var(--muted)] hover:text-red-500"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {/* Line 2: assignments */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--muted)] mt-1">
            <span>group: <span className="text-[var(--text)]">{groupName}</span></span>
            <span>
              schedule:{" "}
              <span className={d.schedule_id ? "text-[var(--text)]" : "text-red-500 font-medium"}>{scheduleName}</span>
            </span>
            <span>rotate: <span className="text-[var(--text)]">{rotateLabel(d.rotate_every_min)}</span></span>
            <span className="inline-flex items-center gap-1">
              <BatteryMedium size={13} /> last battery level:{" "}
              <span className="text-[var(--text)]">
                {d.battery_pct != null ? `${Math.round(d.battery_pct)}%` : "unknown"}
                {d.battery_mv != null ? ` · ${(d.battery_mv / 1000).toFixed(2)}V` : ""}
              </span>
            </span>
            <span title={d.last_seen ? new Date(d.last_seen).toLocaleString() : undefined}>
              last seen: <span className="text-[var(--text)]">{clockTime(d.last_seen)}</span>
            </span>
            {d.firmware && <span>version: <span className="text-[var(--text)]">{d.firmware}</span></span>}
            {d.last_telemetry_at && (
              <span title="When battery/firmware were last read off the frame">
                battery/fw read: <span className="text-[var(--text)]">{clockTime(d.last_telemetry_at)}</span>
              </span>
            )}
          </div>

          {/* Line 3: host + image path + token */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)] mt-0.5">
            <span className="truncate">
              host:{" "}
              {hostUrl ? (
                <a
                  href={hostUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open this frame in a new tab"
                  className="text-blue-500 hover:underline"
                >
                  {d.host}
                </a>
              ) : (
                <code className="text-[var(--text)]">—</code>
              )}
            </span>
            <span className="truncate">image: <code className="text-[var(--text)]">{imagePath}</code></span>
            <span className="truncate">token: <code className="text-[var(--text)]">{token}</code></span>
          </div>
        </div>
      </div>

      {editing && (
        <DeviceEditor device={d} schedules={schedules} groups={groups} onClose={() => setEditing(false)} />
      )}

      {preview && <ImageModal assetId={preview.assetId} label={preview.label} onClose={() => setPreview(null)} />}
    </div>
  );
}

function DeviceEditor({
  device: d, schedules, groups, onClose,
}: {
  device: Device; schedules: Schedule[]; groups: Group[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(d.name);
  const allDevices = useQuery({ queryKey: ["devices"], queryFn: () => apiGet<Device[]>("/api/devices") });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/profiles") });

  const patch = useMutation({
    mutationFn: (body: object) => apiSend<Device>("PATCH", `/api/devices/${d.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });

  return (
    <div className="mt-3 ml-1 border-l-2 border-[var(--border)] pl-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm"
        />
        <Button onClick={() => patch.mutate({ name: name.trim() })} disabled={!name.trim() || name.trim() === d.name}>
          Rename
        </Button>
        <button onClick={onClose} className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--text)]">close</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select label="Profile" value={d.profile_id ?? ""} onChange={(v) => patch.mutate({ profileId: v || null })}
          options={(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <Select label="Schedule" value={d.schedule_id ?? ""} onChange={(v) => patch.mutate({ scheduleId: v || null })}
          options={schedules.map((s) => ({ value: s.id, label: s.name }))} />
        <Select label="Group" value={d.group_id ?? ""} onChange={(v) => patch.mutate({ groupId: v || null })}
          options={groups.map((g) => ({ value: g.id, label: g.name }))} />
        <Select label="Mirror of" value={d.mirror_of ?? ""} onChange={(v) => patch.mutate({ mirrorOf: v || null })}
          options={(allDevices.data ?? []).filter((x) => x.id !== d.id).map((x) => ({ value: x.id, label: x.name }))} />
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          order
          {d.group_id ? (
            <input
              type="number"
              defaultValue={d.position}
              onBlur={(e) => patch.mutate({ position: Number(e.target.value) })}
              className="w-14 rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm"
            />
          ) : (
            <span className="text-[var(--muted)]">n/a</span>
          )}
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Processing
          <select
            value={d.preset || "balanced"}
            onChange={(e) => patch.mutate({ preset: e.target.value })}
            className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm text-[var(--text)]"
          >
            {PRESET_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Rotate
          <RotateEveryInput
            minutes={d.rotate_every_min ?? 60}
            onChange={(rotateEveryMin) => patch.mutate({ rotateEveryMin })}
          />
        </label>
      </div>

      {!d.simulated && <DevicePanel device={d} />}
    </div>
  );
}

function AddFrameModal({ simulated, onClose }: { simulated: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => apiSend<Device>("POST", "/api/devices", { name: name.trim(), simulated }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      onClose();
    },
  });

  return (
    <Modal title={simulated ? "Add simulated frame" : "Add physical frame"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Hallway #1"
          autoFocus
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
        <p className="text-xs text-[var(--muted)] mt-2">
          {simulated
            ? "A simulated frame is driven by the server — handy for testing groups and scheduling without hardware."
            : "Registers a real e-paper frame. After adding, open Edit to set its address and push the image URL."}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus size={15} /> Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm text-[var(--text)]"
      >
        <option value="">none</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FlashModal({ onClose }: { onClose: () => void }) {
  const boards = useQuery({
    queryKey: ["fw-boards"],
    queryFn: () => apiGet<{ boards: Array<{ id: string; label: string }>; tag?: string }>("/api/firmware/boards"),
  });
  const [board, setBoard] = useState("seeedstudio_xiao_ee02");
  const [done, setDone] = useState(false);
  const [probe, setProbe] = useState<ImprovProbe | null>(null);
  const [probing, setProbing] = useState(false);

  async function testUsbWifi() {
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await probeImprovSerial());
    } catch (e) {
      setProbe({ supported: false, detail: (e as Error).message });
    } finally {
      setProbing(false);
    }
  }

  return (
    <Modal title="Flash a frame" onClose={onClose}>
      <p className="text-xs text-[var(--muted)] mb-3">
        Plug a frame in over USB and install the firmware{boards.data?.tag ? ` (${boards.data.tag})` : ""}. Works in
        Chrome/Edge over https or localhost.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={board}
          onChange={(e) => setBoard(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
        >
          {(boards.data?.boards ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <FlashButton board={board} onFinished={() => setDone(true)} />
      </div>

      {done && <WifiSetupSteps />}

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" onClick={testUsbWifi} disabled={probing}>
            {probing ? "Checking…" : "Test USB Wi-Fi (Improv)"}
          </Button>
          <span className="text-[11px] text-[var(--muted)]">
            Checks if this firmware lets you set Wi-Fi over USB instead of the QR/captive portal.
          </span>
        </div>
        {probe && <ImprovResult probe={probe} />}
      </div>
    </Modal>
  );
}

function ImprovResult({ probe }: { probe: ImprovProbe }) {
  if (probe.supported) {
    return (
      <div className="mt-2 rounded-lg border border-green-500/30 bg-green-500/10 p-2.5 text-sm">
        <div className="font-medium text-green-600">✓ USB Wi-Fi supported (Improv-Serial)</div>
        <p className="text-xs text-[var(--text)] mt-1">
          {probe.provisioned
            ? "The frame is already on Wi-Fi. You can re-enter credentials over USB if needed."
            : "You can set the home Wi-Fi over USB — esp-web-tools shows a “Connect to Wi-Fi” step right after flashing, no QR needed."}
          {probe.nextUrl ? ` Device URL: ${probe.nextUrl}` : ""}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm">
      <div className="font-medium text-amber-600">✗ No USB Wi-Fi (Improv not detected)</div>
      <p className="text-xs text-[var(--text)] mt-1">
        This firmware doesn’t answer Improv over USB, so Wi-Fi must be set via the QR / captive-portal flow above.
        {probe.detail ? ` (${probe.detail})` : ""}
      </p>
    </div>
  );
}

function WifiSetupSteps() {
  const steps = [
    "On the frame's screen, scan the Wi-Fi QR code in the bottom-right corner with your phone.",
    "That joins your phone to the frame's own temporary Wi-Fi hotspot (its setup access point).",
    "Wait a few seconds for the captive-portal setup page to open automatically.",
    "Enter your home Wi-Fi name and password there, then press the connect/save button.",
    "The frame reconnects to your network and starts pulling photos — it'll appear online here.",
  ];
  return (
    <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
      <div className="font-medium text-green-600 mb-2">✓ Installation complete — finish Wi-Fi setup</div>
      <ol className="list-decimal pl-5 space-y-1.5 text-sm text-[var(--text)]">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="text-xs text-[var(--muted)] mt-2">
        You can close this dialog once the frame shows photos. Set its host and assignments later via Edit.
      </p>
    </div>
  );
}

const FRAME_FIELDS = [
  "device_name", "rotation_mode", "rotate_interval", "display_orientation", "image_url",
  "auto_rotate", "deep_sleep_enabled",
  "timezone", "sleep_schedule_enabled", "sleep_schedule_start", "sleep_schedule_end",
] as const;
type FrameConfig = Record<string, string | number | boolean>;

// sleep_schedule_start/end are minutes-since-midnight (e.g. 1380 = 23:00, 420 = 07:00).
const minToHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hhmmToMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Firmware stores a POSIX TZ string ("UTC0", "UTC-8", …) where the sign is INVERTED vs the
// conventional UTC offset: UTC+8 (east) → "UTC-8". Offer whole-hour offsets mapped correctly.
const TZ_OFFSETS = Array.from({ length: 27 }, (_, i) => i - 12); // -12 … +14
const offsetToPosix = (off: number) => `UTC${-off}`; // UTC+8 → "UTC-8", UTC-5 → "UTC5", UTC → "UTC0"
const offsetLabel = (off: number) => `UTC${off >= 0 ? "+" : ""}${off}:00`;

interface SystemInfo {
  device_name?: string;
  version?: string;
  board_name?: string;
}

function DevicePanel({ device: d }: { device: Device }) {
  const qc = useQueryClient();
  const [host, setHost] = useState(d.host ?? "");
  const [tokenInput, setTokenInput] = useState(d.accessToken ?? "");
  const [config, setConfig] = useState<FrameConfig | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const serverBase = useQuery({
    queryKey: ["server-base"],
    queryFn: () => apiGet<{ baseUrl: string; requestOrigin: string; effective: string; suggested: string | null }>("/api/server-base"),
  });
  const [baseInput, setBaseInput] = useState("");
  useEffect(() => {
    // Default to the saved value, else the server's detected LAN address (frames can't reach localhost).
    if (serverBase.data) setBaseInput(serverBase.data.baseUrl || serverBase.data.suggested || "");
  }, [serverBase.data]);
  const saveBase = useMutation({
    mutationFn: () => apiSend("PUT", "/api/server-base", { baseUrl: baseInput.trim() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["server-base"] }),
  });
  const setLocal = useMutation({
    mutationFn: (v: boolean) => apiSend("PATCH", `/api/devices/${d.id}`, { isLocal: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
  const targetUrl = `${baseInput || serverBase.data?.effective || ""}/d/${d.id}.png`;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ensureHost(h: string) {
    if (h.trim() && h.trim() !== (d.host ?? "")) {
      await apiSend("PATCH", `/api/devices/${d.id}`, { host: h.trim() });
      qc.invalidateQueries({ queryKey: ["devices"] });
    }
  }
  async function probeInner() {
    // Config first (carries image_url) so the form always refreshes; system-info is best-effort.
    const cfg = await apiGet<FrameConfig>(`/api/devices/${d.id}/frame-config`);
    setConfig(cfg);
    let si: SystemInfo | null = null;
    try {
      si = await apiGet<SystemInfo>(`/api/devices/${d.id}/system-info`);
      setInfo(si);
    } catch {
      /* best effort */
    }
    setMsg(`✓ Reachable — ${si?.device_name ?? cfg.device_name ?? "frame"} ${si?.version ?? ""}`);
  }
  const probe = () => run(async () => {
    await ensureHost(host);
    await probeInner();
  });
  const connect = () =>
    run(async () => {
      await ensureHost(host);
      const r = await apiSend<{ imageUrl: string; localhost: boolean }>("POST", `/api/devices/${d.id}/connect`, {
        baseUrl: baseInput.trim(),
      });
      qc.invalidateQueries({ queryKey: ["devices"] });
      await probeInner();
      setMsg(
        `Connected → ${r.imageUrl}` +
          (r.localhost ? " · set PUBLIC_BASE_URL to your LAN IP so the frame can reach it." : ""),
      );
    });
  const regen = () => run(async () => {
    const r = await apiSend<{ pushed: boolean; accessToken: string }>("POST", `/api/devices/${d.id}/access-token`, {});
    setTokenInput(r.accessToken);
    qc.invalidateQueries({ queryKey: ["devices"] });
    setMsg(r.pushed ? "New token generated and pushed to the frame." : "New token generated — copy it into the frame by hand.");
  });
  // Remote frames: set the token by hand (e.g. one already on the frame) instead of generating.
  const saveToken = () => run(async () => {
    await apiSend("PATCH", `/api/devices/${d.id}`, { accessToken: tokenInput.trim() });
    qc.invalidateQueries({ queryKey: ["devices"] });
    setMsg("Token saved.");
  });
  const save = () =>
    run(async () => {
      if (!config) return;
      const patch = Object.fromEntries(FRAME_FIELDS.filter((k) => k in config).map((k) => [k, config[k]]));
      // The app only works with URL rotation mode — force it, never expose it.
      patch.rotation_mode = "url";
      await apiSend("POST", `/api/devices/${d.id}/frame-config`, patch);
      setMsg("Saved to frame.");
    });
  const onHostname = (h: string) => {
    setHost(h);
    run(async () => {
      await ensureHost(h);
      await probeInner();
    });
  };
  const set = (k: string, v: string | number | boolean) => setConfig((c) => ({ ...(c ?? {}), [k]: v }));

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3 grid lg:grid-cols-2 gap-5">
      {/* Network settings */}
      <div>
        <div className="text-xs font-semibold text-[var(--muted)] mb-2 flex items-center gap-1.5">
          <RadioTower size={13} /> SETTINGS (over WiFi)
        </div>
        <label className="flex items-center gap-2 text-xs mb-2">
          <input
            type="checkbox"
            checked={d.isLocal}
            disabled={setLocal.isPending}
            onChange={(e) => setLocal.mutate(e.target.checked)}
          />
          <span>Frame is on this server's local network</span>
        </label>
        {!d.isLocal && (
          <div className="text-[11px] text-[var(--muted)] mb-2 rounded-md border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5">
            Remote frame — the server can't reach it, so probe/push are disabled. Configure it on the frame's own web page,
            and copy the token + image URL below into it by hand.
          </div>
        )}
        <div className="text-[11px] text-[var(--muted)] mb-1">
          Frame address — the frame's own hostname on your network. The server reaches out to it here to push config and
          trigger rotations.
        </div>
        <div className="flex gap-2 mb-2">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="frame host, e.g. photoframe-office-1.local"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
          />
          <Button onClick={probe} disabled={busy || !host.trim() || !d.isLocal}>
            Probe
          </Button>
        </div>
        <div className="mb-2">
          <div className="text-[11px] text-[var(--muted)] mb-1">
            This server's address (frames fetch images from here)
            {/localhost|127\.0\.0\.1/.test(baseInput) && (
              <span className="text-amber-600">
                {" "}
                — a frame can't reach <code>localhost</code>; use your LAN IP
                {serverBase.data?.suggested ? ` (${serverBase.data.suggested})` : ""}.
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={baseInput}
              onChange={(e) => setBaseInput(e.target.value)}
              placeholder={serverBase.data?.requestOrigin ?? "http://192.168.1.50:8080"}
              className="flex-1 cfg-input"
            />
            <Button variant="ghost" onClick={() => saveBase.mutate()}>
              Save
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-1">
          <Button onClick={connect} disabled={busy || !host.trim() || !d.isLocal}>
            Set Image URL + new token
          </Button>
        </div>
        <p className="text-[11px] text-[var(--muted)] mb-2">
          → sets the frame's Image URL to <code className="text-[var(--text)]">{targetUrl}</code> and a fresh token.
        </p>
        {msg && <p className="text-xs text-[var(--muted)] mb-2">{msg}</p>}

        {info && (
          <div className="text-xs text-[var(--muted)] mb-2">
            {info.device_name} · {info.board_name} · {info.version}
          </div>
        )}

        {/* Frame's own fetch status (read from its /api/config after a probe). */}
        {config && (
          config.last_fetch_error ? (
            <div className="text-xs rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 mb-2">
              <span className="text-red-500 font-medium">Frame's last fetch error:</span>{" "}
              <span className="text-[var(--text)]">{String(config.last_fetch_error)}</span>
              {/^https?:\/\//.test(String(config.image_url ?? "")) && (
                <div className="text-[11px] text-[var(--muted)] mt-1">
                  It's fetching <code className="text-[var(--text)]">{String(config.image_url)}</code> — check this matches
                  the server's current address{serverBase.data?.suggested ? ` (${serverBase.data.suggested})` : ""}.
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-green-600 mb-2">✓ Frame's last fetch OK (no error reported)</div>
          )
        )}

        <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
          <span className="text-[var(--muted)]">Access token:</span>
          {d.hasAccessToken ? <code className="text-[var(--text)] break-all">{d.accessToken}</code> : <span>none</span>}
          {d.hasAccessToken && (
            <button
              onClick={() => { void navigator.clipboard?.writeText(d.accessToken ?? ""); setMsg("Token copied."); }}
              className="text-blue-500 hover:underline"
            >
              copy
            </button>
          )}
          <button onClick={regen} disabled={busy} className="text-blue-500 hover:underline disabled:opacity-40">
            {d.isLocal ? "regenerate" : "generate"}
          </button>
        </div>
        {!d.isLocal && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="paste the frame's token, or Generate"
                className="cfg-input flex-1 text-xs font-mono"
              />
              <Button variant="ghost" onClick={saveToken} disabled={busy || !tokenInput.trim()}>
                Save token
              </Button>
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Remote frame — set the same token here and on the frame's own web page, with image URL{" "}
              <code className="text-[var(--text)]">{`http://<public-server>/d/${d.id}`}</code>.
            </p>
          </div>
        )}

        {config && (
          <div className="space-y-2 text-sm">
            <Row label="Device name">
              <input value={String(config.device_name ?? "")} onChange={(e) => set("device_name", e.target.value)} className="cfg-input w-full" />
            </Row>
            <p className="text-[11px] text-[var(--muted)] -mt-1">Hostname becomes <code>&lt;name&gt;.local</code> after a reboot — make it unique per frame.</p>
            <Row label="Interval (s)">
              <input type="number" value={Number(config.rotate_interval ?? 3600)} onChange={(e) => set("rotate_interval", Number(e.target.value))} className="cfg-input w-28" />
            </Row>
            <Row label="Orientation">
              <select value={String(config.display_orientation ?? "portrait")} onChange={(e) => set("display_orientation", e.target.value)} className="cfg-input">
                <option value="portrait">portrait</option>
                <option value="landscape">landscape</option>
              </select>
            </Row>
            <Row label="Image URL">
              <input value={String(config.image_url ?? "")} onChange={(e) => set("image_url", e.target.value)} className="cfg-input w-full" />
            </Row>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!!config.auto_rotate} onChange={(e) => set("auto_rotate", e.target.checked)} /> auto rotate
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!!config.deep_sleep_enabled} onChange={(e) => set("deep_sleep_enabled", e.target.checked)} /> deep sleep
              </label>
            </div>

            {(() => {
              const currentTz = String(config.timezone ?? "UTC0");
              const known = TZ_OFFSETS.map(offsetToPosix).includes(currentTz);
              return (
                <Row label="Timezone">
                  <select value={currentTz} onChange={(e) => set("timezone", e.target.value)} className="cfg-input">
                    {!known && <option value={currentTz}>{currentTz} (current)</option>}
                    {TZ_OFFSETS.map((off) => (
                      <option key={off} value={offsetToPosix(off)}>
                        {offsetLabel(off)}
                      </option>
                    ))}
                  </select>
                </Row>
              );
            })()}

            {/* Sleep schedule — frame powers down between these times (minutes-since-midnight). */}
            <div className="rounded-lg bg-[var(--panel-muted)] p-2.5 space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={!!config.sleep_schedule_enabled}
                  onChange={(e) => set("sleep_schedule_enabled", e.target.checked)}
                />
                Enable sleep schedule
              </label>
              {!!config.sleep_schedule_enabled && (
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    sleep from
                    <input
                      type="time"
                      value={minToHHMM(Number(config.sleep_schedule_start ?? 1380))}
                      onChange={(e) => set("sleep_schedule_start", hhmmToMin(e.target.value))}
                      className="cfg-input"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    wake at
                    <input
                      type="time"
                      value={minToHHMM(Number(config.sleep_schedule_end ?? 420))}
                      onChange={(e) => set("sleep_schedule_end", hhmmToMin(e.target.value))}
                      className="cfg-input"
                    />
                  </label>
                </div>
              )}
              <p className="text-[11px] text-[var(--muted)]">Uses the frame's timezone above — set it for correct local times.</p>
            </div>

            <Button onClick={save} disabled={busy}>
              Save to frame
            </Button>
          </div>
        )}
      </div>

      {/* USB tools */}
      <div>
        <div className="text-xs font-semibold text-[var(--muted)] mb-2 flex items-center gap-1.5">
          <Usb size={13} /> USB LOG &amp; REBOOT
        </div>
        <SerialConsole onHostname={onHostname} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-[var(--muted)] w-28 shrink-0">{label}</span>
      {children}
    </div>
  );
}
