import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, RefreshCw, Shuffle, ListOrdered, Dices, X } from "lucide-react";
import {
  apiGet,
  apiSend,
  type Profile,
  type LocalAlbum,
  type Person,
  type ProfileLogic,
  type DateMode,
  type OverlayConfigSummary,
} from "../api/client.ts";
import { PageHeader, Card, Button, Badge } from "../components/ui.tsx";
import { LocationMap } from "../components/LocationMap.tsx";

export function Profiles() {
  const qc = useQueryClient();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => apiGet<Profile[]>("/api/profiles") });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first profile (and recover if the selected one is deleted).
  useEffect(() => {
    if (profiles.data && !profiles.data.some((p) => p.id === selectedId)) {
      setSelectedId(profiles.data[0]?.id ?? null);
    }
  }, [profiles.data, selectedId]);

  const create = useMutation({
    mutationFn: () => apiSend<Profile>("POST", "/api/profiles", { name: "New profile" }),
    onSuccess: (p) => {
      setSelectedId(p.id);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  const selected = profiles.data?.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Profiles"
        subtitle="The logic that picks images: local albums + filters (people, place, date, favorites)."
        actions={
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus size={15} /> New profile
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <div className="space-y-2">
          {profiles.data?.length === 0 && <Card>No profiles yet.</Card>}
          {profiles.data?.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                p.id === selectedId ? "border-blue-500 bg-blue-500/5" : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              <div className="font-medium">{p.name}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone="slate">{p.pick}</Badge>
                <Badge tone="slate">{p.localAlbumIds.length} albums</Badge>
                {(p.logic?.location?.polygons?.length ?? 0) > 0 && <Badge tone="blue">map</Badge>}
                {(p.logic?.people?.length ?? 0) > 0 && <Badge tone="blue">{p.logic.people!.length} faces</Badge>}
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <ProfileEditor key={selected.id} profile={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Card className="text-sm text-[var(--muted)]">Select a profile to edit, or create a new one.</Card>
        )}
      </div>
    </div>
  );
}

type TabKey = "map" | "datetime" | "faces" | "albums" | "order";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "datetime", label: "Date/Time" },
  { key: "faces", label: "Faces" },
  { key: "albums", label: "Albums" },
  { key: "order", label: "Viewing order" },
];

function ProfileEditor({ profile, onDeleted }: { profile: Profile; onDeleted: () => void }) {
  const qc = useQueryClient();
  const locals = useQuery({ queryKey: ["local-albums"], queryFn: () => apiGet<LocalAlbum[]>("/api/local-albums") });
  const people = useQuery({ queryKey: ["people"], queryFn: () => apiGet<Person[]>("/api/people") });

  const overlayConfigs = useQuery({ queryKey: ["overlay-configs"], queryFn: () => apiGet<OverlayConfigSummary[]>("/api/overlay-configs") });

  const [tab, setTab] = useState<TabKey>("albums");
  const [name, setName] = useState(profile.name);
  const [pick, setPick] = useState(profile.pick);
  const [favorRecent, setFavorRecent] = useState(profile.favorRecent);
  const [albums, setAlbums] = useState<Set<string>>(new Set(profile.localAlbumIds));
  const [logic, setLogic] = useState<ProfileLogic>(profile.logic ?? {});
  const [overlayConfigId, setOverlayConfigId] = useState<string | null>(profile.overlayConfigId);
  const [previewKey, setPreviewKey] = useState(0);
  const [zoom, setZoom] = useState(false);
  const previewSrc = `/api/profiles/${profile.id}/preview.png?overlayConfig=${overlayConfigId ?? ""}&k=${previewKey}`;

  const save = useMutation({
    mutationFn: () =>
      apiSend<Profile>("PATCH", `/api/profiles/${profile.id}`, {
        name,
        pick,
        favorRecent,
        localAlbumIds: [...albums],
        logic,
        overlayConfigId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      setPreviewKey((k) => k + 1);
    },
  });
  const remove = useMutation({
    mutationFn: () => apiSend("DELETE", `/api/profiles/${profile.id}`),
    onSuccess: () => {
      onDeleted();
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  const togglePerson = (id: string) => {
    const set = new Set(logic.people ?? []);
    set.has(id) ? set.delete(id) : set.add(id);
    setLogic({ ...logic, people: [...set] });
  };
  const date = logic.date ?? { mode: "none" as DateMode };

  // Per-filter enable toggles (a missing flag = on, so existing profiles keep working).
  const filterOn = (k: keyof NonNullable<ProfileLogic["enabled"]>) => logic.enabled?.[k] ?? true;
  const setFilterOn = (k: keyof NonNullable<ProfileLogic["enabled"]>, v: boolean) =>
    setLogic({ ...logic, enabled: { ...logic.enabled, [k]: v } });

  // Tab chips show a badge only when a filter is both enabled AND configured.
  const polygonCount = logic.location?.polygons?.length ?? 0;
  const placeSet = !!(logic.city || logic.state || logic.country);
  const mapActive = (filterOn("location") && polygonCount > 0) || (filterOn("place") && placeSet);
  const facesActive = filterOn("people") ? logic.people?.length ?? 0 : 0;
  const badges: Record<TabKey, number | string | null> = {
    map: mapActive ? "•" : null,
    datetime: filterOn("date") && date.mode !== "none" ? "•" : null,
    faces: facesActive || null,
    albums: albums.size || null,
    order: null,
  };

  return (
    <Card>
      <div className="grid md:grid-cols-[1fr_200px] gap-5">
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            />
          </Field>

          {/* Tab bar */}
          <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                    on ? "border-blue-500 text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {t.label}
                  {badges[t.key] != null && (
                    <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-blue-500/15 text-blue-500 text-[10px] font-semibold">
                      {badges[t.key]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* --- Map / location --- */}
          {tab === "map" && (
            <div className="space-y-4">
              <div className={filterOn("location") ? "" : "opacity-50"}>
                <FilterToggle
                  label="Filter by map region"
                  on={filterOn("location")}
                  onChange={(v) => setFilterOn("location", v)}
                />
                <div className="mt-2">
                  <LocationMap
                    value={logic.location}
                    onChange={(location) => setLogic({ ...logic, location })}
                    localAlbumIds={[...albums]}
                  />
                </div>
              </div>
              <div className={filterOn("place") ? "" : "opacity-50"}>
                <FilterToggle
                  label="Filter by place name (from photo metadata)"
                  on={filterOn("place")}
                  onChange={(v) => setFilterOn("place", v)}
                />
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <TextField label="City" value={logic.city} onChange={(v) => setLogic({ ...logic, city: v })} />
                  <TextField label="State" value={logic.state} onChange={(v) => setLogic({ ...logic, state: v })} />
                  <TextField label="Country" value={logic.country} onChange={(v) => setLogic({ ...logic, country: v })} />
                </div>
              </div>
            </div>
          )}

          {/* --- Date / time --- */}
          {tab === "datetime" && (
            <div className={filterOn("date") ? "" : "opacity-50"}>
              <FilterToggle label="Filter by date" on={filterOn("date")} onChange={(v) => setFilterOn("date", v)} />
              <Field label="Date">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={date.mode}
                  onChange={(e) => setLogic({ ...logic, date: { ...date, mode: e.target.value as DateMode } })}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
                >
                  <option value="none">Any date</option>
                  <option value="on_this_day">On this day (every year)</option>
                  <option value="years_ago">Years ago</option>
                  <option value="range">Date range</option>
                </select>
                {date.mode === "years_ago" && (
                  <input
                    type="number"
                    min={1}
                    value={date.years ?? 5}
                    onChange={(e) => setLogic({ ...logic, date: { ...date, years: Number(e.target.value) } })}
                    className="w-20 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm"
                  />
                )}
                {date.mode === "range" && (
                  <>
                    <input
                      type="date"
                      value={date.from ?? ""}
                      onChange={(e) => setLogic({ ...logic, date: { ...date, from: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm"
                    />
                    <input
                      type="date"
                      value={date.to ?? ""}
                      onChange={(e) => setLogic({ ...logic, date: { ...date, to: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm"
                    />
                  </>
                )}
              </div>
              </Field>
            </div>
          )}

          {/* --- Faces / people --- */}
          {tab === "faces" && (
            <div className={filterOn("people") ? "" : "opacity-50"}>
              <FilterToggle label="Filter by people" on={filterOn("people")} onChange={(v) => setFilterOn("people", v)} />
              <Field label="People (matches photos with ANY selected person)">
              {people.data && people.data.length > 0 ? (
                <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto">
                  {people.data.map((p) => {
                    const on = (logic.people ?? []).includes(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => togglePerson(p.id)}
                        className={`flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-xs border ${
                          on ? "border-blue-500 bg-blue-500/10" : "border-[var(--border)]"
                        }`}
                      >
                        <img src={`/api/people/${p.id}/thumbnail`} alt="" className="w-5 h-5 rounded-full object-cover" />
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">No named people in Immich.</p>
              )}
              </Field>
            </div>
          )}

          {/* --- Albums --- */}
          {tab === "albums" && (
            <div className="space-y-4">
              <Field label="Local albums">
                {locals.data?.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">Create a local album first (Albums tab).</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {locals.data?.map((l) => {
                      const on = albums.has(l.id);
                      return (
                        <button
                          key={l.id}
                          onClick={() => {
                            const s = new Set(albums);
                            s.has(l.id) ? s.delete(l.id) : s.add(l.id);
                            setAlbums(s);
                          }}
                          className={`rounded-full px-3 py-1 text-xs border ${
                            on ? "border-blue-500 bg-blue-500/10 text-[var(--text)]" : "border-[var(--border)] text-[var(--muted)]"
                          }`}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!logic.favorite} onChange={(e) => setLogic({ ...logic, favorite: e.target.checked })} />
                Favorites only
              </label>
            </div>
          )}

          {/* --- Viewing order --- */}
          {tab === "order" && (
            <Field label="Viewing order">
              <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden flex-wrap">
                <Seg on={pick === "random"} onClick={() => setPick("random")}>
                  <Dices size={14} /> Random
                </Seg>
                <Seg on={pick === "shuffle"} onClick={() => setPick("shuffle")}>
                  <Shuffle size={14} /> Random sequence
                </Seg>
                <Seg on={pick === "sequence"} onClick={() => setPick("sequence")}>
                  <ListOrdered size={14} /> Sequence
                </Seg>
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-1.5">
                {pick === "random" && "Any photo at random — may repeat before all are shown."}
                {pick === "shuffle" && "Every photo once in a random order, then reshuffles."}
                {pick === "sequence" && "In order, oldest to newest."}
              </p>
              {pick !== "sequence" && (
                <label className="flex items-center gap-2 text-sm cursor-pointer mt-3">
                  <input type="checkbox" checked={favorRecent} onChange={(e) => setFavorRecent(e.target.checked)} />
                  Favor recent / new photos
                </label>
              )}

              <div className="border-t border-[var(--border)] pt-3 mt-4">
                <p className="text-[11px] text-[var(--muted)]">
                  The image processing style (balanced, vivid, greyscale, …) is now set per device under the Dashboard,
                  not per profile.
                </p>
              </div>
            </Field>
          )}

          <div className="pt-3 border-t border-[var(--border)] mt-2">
            <div className="text-xs text-[var(--muted)] mb-1">Overlays</div>
            <select
              value={overlayConfigId ?? ""}
              onChange={(e) => setOverlayConfigId(e.target.value || null)}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
            >
              <option value="">None</option>
              {overlayConfigs.data?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Widgets composited onto this profile's photos. Manage configs on the Overlays page.
            </p>
          </div>

          <div className="flex gap-2 pt-1 border-t border-[var(--border)] mt-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="mt-3">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="danger" onClick={() => remove.mutate()} className="mt-3">
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        </div>

        <div>
          <div className="text-xs text-[var(--muted)] mb-2 flex items-center justify-between">
            Preview
            <button onClick={() => setPreviewKey((k) => k + 1)} className="hover:text-[var(--text)]">
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="aspect-[3/4] rounded-md bg-[var(--panel-muted)] overflow-hidden flex items-center justify-center">
            {albums.size > 0 ? (
              <img
                key={previewKey}
                src={previewSrc}
                alt=""
                onClick={() => setZoom(true)}
                className="w-full h-full object-contain cursor-zoom-in"
              />
            ) : (
              <span className="text-xs text-[var(--muted)] px-3 text-center">Pick a local album to preview</span>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1">Save first; preview shows a matching photo. Click to enlarge.</p>
        </div>
      </div>

      {zoom && albums.size > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6" onClick={() => setZoom(false)}>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img src={previewSrc} alt="" className="max-w-[90vw] max-h-[88vh] rounded-lg object-contain shadow-2xl" />
            <button
              onClick={() => setZoom(false)}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function FilterToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
      {!on && <span className="text-[11px] font-normal text-[var(--muted)]">(off)</span>}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-[var(--muted)] mb-1.5">{label}</div>
      {children}
    </div>
  );
}
function TextField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-[var(--muted)]">
      {label}
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm text-[var(--text)]"
      />
    </label>
  );
}
function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${on ? "bg-blue-600 text-white" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}
    >
      {children}
    </button>
  );
}
