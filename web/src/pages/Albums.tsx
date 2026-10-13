import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Check, EyeOff, X } from "lucide-react";
import { apiGet, apiSend, thumbUrl, type Album, type LocalAlbum } from "../api/client.ts";
import { PageHeader, Card, Button, Badge } from "../components/ui.tsx";

export function Albums() {
  const qc = useQueryClient();
  const locals = useQuery({ queryKey: ["local-albums"], queryFn: () => apiGet<LocalAlbum[]>("/api/local-albums") });
  const immichAlbums = useQuery({ queryKey: ["albums"], queryFn: () => apiGet<Album[]>("/api/albums") });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first local album (and recover if the selected one disappears).
  useEffect(() => {
    if (locals.data && !locals.data.some((l) => l.id === selectedId)) {
      setSelectedId(locals.data[0]?.id ?? null);
    }
  }, [locals.data, selectedId]);

  const countById = new Map(immichAlbums.data?.map((a) => [a.id, a.assetCount]) ?? []);
  const photoTotal = (l: LocalAlbum) =>
    l.sources.filter((s) => s.type === "immich").reduce((sum, s) => sum + (countById.get(s.ref) ?? 0), 0);

  const create = useMutation({
    mutationFn: () => apiSend<LocalAlbum>("POST", "/api/local-albums", { name: "New album" }),
    onSuccess: (la) => {
      setSelectedId(la.id);
      qc.invalidateQueries({ queryKey: ["local-albums"] });
    },
  });

  const selected = locals.data?.find((l) => l.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Albums"
        subtitle="Local albums are pools built from your Immich albums. Profiles draw from these."
        actions={
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus size={15} /> New album
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <div className="space-y-2">
          {locals.data?.length === 0 && <Card>No local albums yet. Create one to start.</Card>}
          {locals.data?.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelectedId(l.id)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                l.id === selectedId ? "border-blue-500 bg-blue-500/5" : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              <div className="font-medium">{l.name}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone="slate">{l.sources.length} Immich albums</Badge>
                <Badge tone="slate">{photoTotal(l).toLocaleString()} photos</Badge>
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <LocalAlbumEditor key={selected.id} album={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Card className="text-sm text-[var(--muted)]">Select a local album, or create a new one.</Card>
        )}
      </div>
    </div>
  );
}

function LocalAlbumEditor({ album, onDeleted }: { album: LocalAlbum; onDeleted: () => void }) {
  const qc = useQueryClient();
  const immichAlbums = useQuery({ queryKey: ["albums"], queryFn: () => apiGet<Album[]>("/api/albums") });
  const assets = useQuery({
    queryKey: ["local-album-assets", album.id, album.sources.length],
    queryFn: () => apiGet<{ ids: string[]; total: number; ignored: string[] }>(`/api/local-albums/${album.id}/assets`),
  });
  const toggleIgnore = useMutation({
    mutationFn: ({ id, ignore }: { id: string; ignore: boolean }) =>
      ignore ? apiSend("POST", "/api/ignored", { assetId: id }) : apiSend("DELETE", `/api/ignored/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["local-album-assets"] }),
  });
  const ignoredSet = new Set(assets.data?.ignored ?? []);
  const [name, setName] = useState(album.name);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [modalId, setModalId] = useState<string | null>(null);
  const [refs, setRefs] = useState<Set<string>>(new Set(album.sources.filter((s) => s.type === "immich").map((s) => s.ref)));

  useEffect(() => {
    setName(album.name);
    setRefs(new Set(album.sources.filter((s) => s.type === "immich").map((s) => s.ref)));
  }, [album]);

  const save = useMutation({
    mutationFn: () =>
      apiSend("PATCH", `/api/local-albums/${album.id}`, {
        name,
        sources: [...refs].map((ref) => ({ type: "immich", ref })),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["local-albums"] }),
  });
  const remove = useMutation({
    mutationFn: () => apiSend("DELETE", `/api/local-albums/${album.id}`),
    onSuccess: () => {
      onDeleted();
      qc.invalidateQueries({ queryKey: ["local-albums"] });
    },
  });

  function toggle(id: string) {
    setRefs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm font-medium outline-none focus:border-blue-500"
        />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="danger" onClick={() => remove.mutate()}>
          <Trash2 size={14} />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs text-[var(--muted)]">Immich albums included in this pool</div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide albums under 10 photos
        </label>
      </div>
      <div className="grid grid-cols-6 sm:grid-cols-9 lg:grid-cols-12 gap-2">
        {immichAlbums.data
          ?.filter((a) => !hideEmpty || a.assetCount >= 10 || refs.has(a.id))
          .map((a) => {
            const on = refs.has(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggle(a.id)}
                title={`${a.name} · ${a.assetCount} photos`}
                className={`text-left rounded-md border overflow-hidden transition-all ${
                  on ? "border-blue-500 ring-1 ring-blue-500/40" : "border-[var(--border)] hover:border-[var(--muted)]"
                }`}
              >
                <div className="relative aspect-square bg-[var(--panel-muted)]">
                  {a.thumbnailAssetId && <img src={thumbUrl(a.thumbnailAssetId)} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  {on && (
                    <div className="absolute top-0.5 right-0.5 bg-blue-600 text-white rounded-full p-0.5">
                      <Check size={9} />
                    </div>
                  )}
                </div>
                <div className="px-1 py-0.5">
                  <div className="text-[10px] leading-tight truncate">{a.name}</div>
                  <div className="text-[10px] leading-tight text-[var(--muted)]">{a.assetCount}</div>
                </div>
              </button>
            );
          })}
      </div>

      <div className="text-xs text-[var(--muted)] mt-5 mb-2">
        Photos in this album{assets.data ? ` (${assets.data.total})` : ""} — click a photo to ignore it (never shown on frames)
      </div>
      {assets.isLoading ? (
        <div className="text-sm text-[var(--muted)]">Loading photos…</div>
      ) : !assets.data || assets.data.ids.length === 0 ? (
        <div className="text-sm text-[var(--muted)]">No photos — add an Immich album above.</div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
          {assets.data.ids.map((id) => {
            const ign = ignoredSet.has(id);
            return (
              <div
                key={id}
                className="relative aspect-square rounded overflow-hidden bg-[var(--panel-muted)] group"
              >
                <img
                  src={thumbUrl(id)}
                  alt=""
                  loading="lazy"
                  onClick={() => setModalId(id)}
                  title="Click to enlarge"
                  className={`w-full h-full object-cover cursor-zoom-in ${ign ? "opacity-25" : ""}`}
                />
                {ign && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <EyeOff size={16} className="text-[var(--text)]" />
                  </div>
                )}
                {/* Ignore toggle — separate from the click-to-enlarge image. */}
                <button
                  onClick={() => toggleIgnore.mutate({ id, ignore: !ign })}
                  title={ign ? "Ignored — click to show again" : "Ignore (never show on frames)"}
                  className={`absolute top-1 right-1 rounded-full p-1 bg-black/55 text-white transition-opacity ${
                    ign ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  } hover:bg-black/80`}
                >
                  <EyeOff size={12} />
                </button>
              </div>
            );
          })}
          {assets.data.total > assets.data.ids.length && (
            <div className="aspect-square rounded bg-[var(--panel-muted)] flex items-center justify-center text-xs text-[var(--muted)]">
              +{assets.data.total - assets.data.ids.length}
            </div>
          )}
        </div>
      )}

      {modalId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6" onClick={() => setModalId(null)}>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img src={`${thumbUrl(modalId)}?size=preview`} alt="" className="max-w-[90vw] max-h-[88vh] rounded-lg object-contain shadow-2xl" />
            <button
              onClick={() => { toggleIgnore.mutate({ id: modalId, ignore: !ignoredSet.has(modalId) }); }}
              className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 bg-black/60 text-white rounded-full px-3 py-1.5 text-xs hover:bg-black/80"
            >
              <EyeOff size={13} /> {ignoredSet.has(modalId) ? "Un-ignore" : "Ignore"}
            </button>
            <button
              onClick={() => setModalId(null)}
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
