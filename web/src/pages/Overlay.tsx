import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Plus, Trash2, MapPin, Pencil, Layers } from "lucide-react";
import {
  apiGet,
  apiSend,
  type Overlay,
  type OverlayType,
  type OverlayPosition,
  type OverlayItem,
  type OverlayConfig,
  type OverlayConfigSummary,
  type GeoResult,
  type Person,
} from "../api/client.ts";
import { PageHeader, Card, Button } from "../components/ui.tsx";

const LABELS: Record<OverlayType, string> = {
  battery: "Battery level",
  next_photo: "Next photo",
  weather: "Weather",
  todos: "To-do list",
  birthdays: "Birthdays",
  photo_date: "Photo date",
  photo_place: "Photo location",
  local_time: "Local time/date",
};
const POSITIONS: OverlayPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export function Overlay() {
  const qc = useQueryClient();
  const configs = useQuery({ queryKey: ["overlay-configs"], queryFn: () => apiGet<OverlayConfigSummary[]>("/api/overlay-configs") });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? configs.data?.[0]?.id ?? null;
  const config = useQuery({
    queryKey: ["overlay-config", effectiveId],
    queryFn: () => apiGet<OverlayConfig>(`/api/overlay-configs/${effectiveId}`),
    enabled: !!effectiveId,
  });
  const [previewKey, setPreviewKey] = useState(0);
  const refreshPreview = () => setPreviewKey((k) => k + 1);
  const [activeType, setActiveType] = useState<OverlayType | null>(null);
  const overlaysList = config.data?.overlays ?? [];
  const activeOverlay = overlaysList.find((o) => o.type === activeType) ?? overlaysList[0];

  const create = useMutation({
    mutationFn: (name: string) => apiSend<OverlayConfig>("POST", "/api/overlay-configs", { name }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["overlay-configs"] });
      setSelectedId(c.id);
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiSend("PATCH", `/api/overlay-configs/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overlay-configs"] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiSend("DELETE", `/api/overlay-configs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["overlay-configs"] });
      setSelectedId(null);
    },
  });

  const newConfig = () => {
    const name = window.prompt("Name this overlay config (e.g. \"Living room\")");
    if (name?.trim()) create.mutate(name.trim());
  };

  return (
    <div>
      <PageHeader
        title="Overlays"
        subtitle="Named sets of widgets composited onto photos. Assign a config to a profile under Profiles."
        actions={<Button onClick={newConfig}><Plus size={15} /> New config</Button>}
      />

      {configs.data && configs.data.length === 0 ? (
        <Card className="flex flex-col items-center text-center py-12 border-dashed">
          <Layers className="text-[var(--muted)] mb-2" size={28} />
          <div className="font-medium">No overlay configs yet</div>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-sm">
            Create one, enable the widgets you want, then pick it in a profile's settings.
          </p>
          <Button className="mt-3" onClick={newConfig}><Plus size={15} /> New config</Button>
        </Card>
      ) : (
        <>
          {/* Config selector bar */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <select
              value={effectiveId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
            >
              {configs.data?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {effectiveId && (
              <>
                <button
                  onClick={() => {
                    const name = window.prompt("Rename config", config.data?.name);
                    if (name?.trim()) rename.mutate({ id: effectiveId, name: name.trim() });
                  }}
                  className="p-1.5 rounded text-[var(--muted)] hover:text-[var(--text)]"
                  title="Rename"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => { if (confirm(`Delete config "${config.data?.name}"?`)) del.mutate(effectiveId); }}
                  className="p-1.5 rounded text-[var(--muted)] hover:text-red-500"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
            <div>
              {/* Tabs — one per overlay type. Enabled ones show in white, disabled in grey. */}
              <div className="flex flex-wrap gap-1 border-b border-[var(--border)] mb-3">
                {overlaysList.map((o) => {
                  const isActive = activeOverlay?.type === o.type;
                  return (
                    <button
                      key={o.type}
                      onClick={() => setActiveType(o.type)}
                      className={`px-3 py-1.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                        isActive ? "border-blue-500" : "border-transparent"
                      } ${o.enabled ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                    >
                      {LABELS[o.type]}
                    </button>
                  );
                })}
              </div>
              {activeOverlay && (
                <OverlayCard key={activeOverlay.type} configId={effectiveId!} overlay={activeOverlay} onChanged={refreshPreview} />
              )}
            </div>

            <div className="lg:sticky lg:top-8 self-start">
              <div className="text-xs text-[var(--muted)] mb-2 flex items-center justify-between">
                Live preview
                <button onClick={refreshPreview} className="hover:text-[var(--text)]">
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--panel-muted)] aspect-[3/4]">
                <img key={previewKey} src={`/api/overlays/preview.png?config=${effectiveId}&k=${previewKey}`} alt="" className="w-full h-full object-contain" />
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-1">Sample photo with a 72% battery. Frames show their own battery + next photo.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OverlayCard({ configId, overlay: o, onChanged }: { configId: string; overlay: Overlay; onChanged: () => void }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (patch: Partial<Overlay>) => apiSend<Overlay>("PUT", `/api/overlay-configs/${configId}/overlays/${o.type}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["overlay-config", configId] });
      onChanged();
    },
  });

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="font-medium">{LABELS[o.type]}</div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={o.enabled}
            onChange={(e) => update.mutate({ enabled: e.target.checked })}
            className="sr-only peer"
          />
          <span className="w-9 h-5 bg-[var(--panel-muted)] border border-[var(--border)] rounded-full peer-checked:bg-blue-600 relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-4" />
        </label>
      </div>

      {o.enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">Position</div>
              <div className="grid grid-cols-2 gap-1 w-24">
                {POSITIONS.map((p) => (
                  <button
                    key={p}
                    onClick={() => update.mutate({ position: p })}
                    title={p}
                    className={`h-7 rounded border text-[9px] ${
                      o.position === p ? "border-blue-500 bg-blue-500/15" : "border-[var(--border)]"
                    }`}
                  >
                    {p.startsWith("top") ? "▲" : "▼"}
                    {p.endsWith("left") ? "◀" : "▶"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">Size {o.scale.toFixed(1)}×</div>
              <input
                type="range"
                min={0.6}
                max={2}
                step={0.1}
                defaultValue={o.scale}
                onMouseUp={(e) => update.mutate({ scale: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={(e) => update.mutate({ scale: Number((e.target as HTMLInputElement).value) })}
              />
            </div>
          </div>

          {o.type === "weather" && <WeatherConfig overlay={o} onSave={(config) => update.mutate({ config })} />}
          {o.type === "todos" && <ItemList kind="todo" onChanged={onChanged} />}
          {o.type === "birthdays" && <ItemList kind="birthday" onChanged={onChanged} />}
        </div>
      )}
    </Card>
  );
}

function WeatherConfig({ overlay, onSave }: { overlay: Overlay; onSave: (config: Record<string, unknown>) => void }) {
  const [q, setQ] = useState("");
  const location = String(overlay.config.location ?? "");
  const units = overlay.config.units === "F" ? "F" : "C";
  const geo = useQuery({
    queryKey: ["geocode", q],
    queryFn: () => apiGet<GeoResult[]>(`/api/weather/geocode?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });

  return (
    <div className="border-t border-[var(--border)] pt-3">
      <div className="flex items-center gap-2 text-sm mb-2">
        <MapPin size={14} className="text-[var(--muted)]" />
        {location ? <span>{location}</span> : <span className="text-[var(--muted)]">No location set</span>}
        <div className="flex-1" />
        <div className="inline-flex rounded border border-[var(--border)] overflow-hidden text-xs">
          {(["C", "F"] as const).map((u) => (
            <button
              key={u}
              onClick={() => onSave({ ...overlay.config, units: u })}
              className={`px-2 py-1 ${units === u ? "bg-blue-600 text-white" : "text-[var(--muted)]"}`}
            >
              °{u}
            </button>
          ))}
        </div>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a city…"
        className="w-full rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm"
      />
      {geo.data && geo.data.length > 0 && (
        <div className="mt-1 border border-[var(--border)] rounded divide-y divide-[var(--border)]">
          {geo.data.map((r, i) => (
            <button
              key={i}
              onClick={() => {
                onSave({ ...overlay.config, location: r.label });
                setQ("");
              }}
              className="block w-full text-left px-2 py-1.5 text-sm hover:bg-[var(--hover)]"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemList({ kind, onChanged }: { kind: "todo" | "birthday"; onChanged: () => void }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["overlay-items", kind], queryFn: () => apiGet<OverlayItem[]>(`/api/overlay-items?kind=${kind}`) });
  const people = useQuery({
    queryKey: ["people"],
    queryFn: () => apiGet<Person[]>("/api/people"),
    enabled: kind === "birthday",
  });
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [ref, setRef] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["overlay-items", kind] });
    onChanged();
  };
  const add = useMutation({
    mutationFn: () =>
      apiSend("POST", "/api/overlay-items", { kind, text: text.trim(), date: kind === "birthday" ? date : null, ref }),
    onSuccess: () => {
      setText("");
      setDate("");
      setRef(null);
      invalidate();
    },
  });
  const del = useMutation({ mutationFn: (id: string) => apiSend("DELETE", `/api/overlay-items/${id}`), onSuccess: invalidate });
  const toggle = useMutation({
    mutationFn: (it: OverlayItem) => apiSend("PATCH", `/api/overlay-items/${it.id}`, { done: !it.done }),
    onSuccess: invalidate,
  });

  function pickPerson(id: string) {
    const p = people.data?.find((x) => x.id === id);
    if (!p) {
      setRef(null);
      return;
    }
    setRef(p.id);
    setText(p.name);
    if (p.birthDate) setDate(p.birthDate.slice(0, 10)); // YYYY-MM-DD
  }

  return (
    <div className="border-t border-[var(--border)] pt-3">
      <div className="space-y-1 mb-2">
        {items.data?.length === 0 && <div className="text-xs text-[var(--muted)]">Nothing yet.</div>}
        {items.data?.map((it) => (
          <div key={it.id} className="flex items-center gap-2 text-sm">
            {kind === "todo" && <input type="checkbox" checked={it.done} onChange={() => toggle.mutate(it)} />}
            {kind === "birthday" && it.ref && (
              <img src={`/api/people/${it.ref}/thumbnail`} alt="" className="w-6 h-6 rounded-full object-cover" />
            )}
            <span className={`flex-1 ${it.done ? "line-through text-[var(--muted)]" : ""}`}>
              {it.text}
              {it.date && <span className="text-xs text-[var(--muted)] ml-2">{it.date}</span>}
            </span>
            <button onClick={() => del.mutate(it.id)} className="text-[var(--muted)] hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {kind === "birthday" && people.data && people.data.length > 0 && (
        <select
          value={ref ?? ""}
          onChange={(e) => pickPerson(e.target.value)}
          className="w-full mb-2 rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm"
        >
          <option value="">Link an Immich person (shows their photo)…</option>
          {people.data.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "birthday" ? "Name" : "New task"}
          className="flex-1 rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm"
        />
        {kind === "birthday" && (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm"
          />
        )}
        <Button type="submit" disabled={!text.trim()}>
          <Plus size={14} />
        </Button>
      </form>
    </div>
  );
}
