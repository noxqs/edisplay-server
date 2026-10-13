import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { apiGet, type GeoLocationFilter, type GeoResult, type PhotoLocation } from "../api/client.ts";

type Ring = Array<[number, number]>;

/**
 * Freeform polygon painter on an OpenStreetMap base layer. Each drawn polygon is a
 * region photos must fall inside (matched against Immich GPS coordinates server-side).
 * Existing geotagged photos in the given local albums are plotted as dots for reference.
 */
export function LocationMap({
  value,
  onChange,
  localAlbumIds = [],
}: {
  value: GeoLocationFilter | undefined;
  onChange: (v: GeoLocationFilter) => void;
  localAlbumIds?: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.FeatureGroup | null>(null);
  const dotsRef = useRef<L.LayerGroup | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [search, setSearch] = useState("");
  const [showPhotos, setShowPhotos] = useState(true);
  const [points, setPoints] = useState<PhotoLocation[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const albumKey = JSON.stringify([...localAlbumIds].sort());
  const polygons = value?.polygons ?? [];
  const polyKey = JSON.stringify(polygons);
  // How many loaded photos fall inside the drawn regions (null = no regions drawn).
  const matched = useMemo(
    () => (polygons.length ? points.reduce((n, p) => n + (pointInAnyPolygon(p.lat, p.lng, polygons) ? 1 : 0), 0) : null),
    // polyKey is a stable serialization of polygons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, polyKey],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { center: [20, 0], zoom: 2, worldCopyJump: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const group = L.featureGroup().addTo(map);
    mapRef.current = map;
    groupRef.current = group;
    // Created here (not in the dots effect) so its lifecycle is tied to this map instance;
    // otherwise a StrictMode/tab remount leaves a stale layer attached to a removed map.
    dotsRef.current = L.layerGroup().addTo(map);

    const serialize = () => {
      const polygons: Ring[] = [];
      group.eachLayer((layer) => {
        const latlngs = (layer as L.Polygon).getLatLngs?.();
        if (!latlngs) return;
        // Outer ring only (index 0); polygons may nest one level.
        const ring = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs) as L.LatLng[];
        const pts = ring.map((p) => [p.lat, p.lng] as [number, number]);
        if (pts.length >= 3) polygons.push(pts);
      });
      onChangeRef.current({ polygons });
    };

    const track = (layer: L.Layer) => {
      group.addLayer(layer);
      layer.on("pm:edit", serialize);
      layer.on("pm:dragend", serialize);
    };

    // Toolbar: polygon draw + edit/drag/remove only.
    map.pm.addControls({
      position: "topright",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawCircle: false,
      drawText: false,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      rotateMode: false,
      removalMode: true,
    });
    map.pm.setLang("en");

    map.on("pm:create", (e: { layer: L.Layer }) => {
      track(e.layer);
      serialize();
    });
    map.on("pm:remove", (e: { layer: L.Layer }) => {
      group.removeLayer(e.layer);
      serialize();
    });

    // Load existing polygons (editable).
    const initial = value?.polygons ?? [];
    for (const ring of initial) {
      if (ring.length < 3) continue;
      const poly = L.polygon(ring.map(([lat, lng]) => [lat, lng]) as [number, number][]);
      poly.addTo(map);
      track(poly);
    }
    if (initial.length > 0) {
      const b = group.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 12 });
    }

    // Leaflet needs a size recalc once the container has laid out.
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
      dotsRef.current = null;
    };
    // Mount once; `value` is only used to seed the initial polygons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch geotagged photos for the album scope (re-runs when scope or toggle changes).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setPoints([]);
    setTotal(null);
    if (!showPhotos) return;

    let cancelled = false;
    const query = [...localAlbumIds].map((id) => `localAlbumId=${encodeURIComponent(id)}`).join("&");
    apiGet<{ points: PhotoLocation[]; total: number }>(`/api/photo-locations${query ? `?${query}` : ""}`)
      .then((data) => {
        if (cancelled) return;
        setPoints(data.points);
        setTotal(data.total);
        // Frame the photos so they're visible (unless the user already drew regions to focus on).
        const hasPolygons = (groupRef.current?.getLayers().length ?? 0) > 0;
        if (data.points.length > 0 && !hasPolygons) {
          map.fitBounds(L.latLngBounds(data.points.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 12 });
        }
        map.invalidateSize();
      })
      .catch(() => {
        if (!cancelled) {
          setPoints([]);
          setTotal(0);
        }
      });
    return () => {
      cancelled = true;
    };
    // albumKey is a stable serialization of localAlbumIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumKey, showPhotos]);

  // Draw/recolor dots: green inside a region, grey outside (plain blue when no regions).
  useEffect(() => {
    const layer = dotsRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showPhotos) return;
    const polys = JSON.parse(polyKey) as Ring[];
    const hasPolys = polys.length > 0;
    for (const p of points) {
      const inside = hasPolys && pointInAnyPolygon(p.lat, p.lng, polys);
      const muted = hasPolys && !inside;
      L.circleMarker([p.lat, p.lng], {
        radius: 3,
        weight: 1,
        color: !hasPolys ? "#1d4ed8" : inside ? "#15803d" : "#94a3b8",
        fillColor: !hasPolys ? "#3b82f6" : inside ? "#22c55e" : "#cbd5e1",
        fillOpacity: muted ? 0.4 : 0.8,
        pmIgnore: true, // not editable by the draw tools
      })
        .bindPopup(`<img src="/thumbnail/${p.id}" width="128" style="display:block;border-radius:6px" alt="" />`, {
          closeButton: false,
          minWidth: 128,
        })
        .addTo(layer);
    }
    // polyKey is a stable serialization of polygons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, polyKey, showPhotos]);

  const jumpTo = async (q: string) => {
    if (q.trim().length < 2) return;
    try {
      const results = await apiGet<GeoResult[]>(`/api/weather/geocode?q=${encodeURIComponent(q)}`);
      const r = results[0];
      if (r && mapRef.current) mapRef.current.setView([r.latitude, r.longitude], 9);
    } catch {
      /* ignore */
    }
  };

  const clearAll = () => {
    groupRef.current?.clearLayers();
    onChangeRef.current({ polygons: [] });
  };

  const count = value?.polygons?.length ?? 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), jumpTo(search))}
          placeholder="Find a place to jump to…"
          className="flex-1 rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => jumpTo(search)}
          className="rounded border border-[var(--border)] px-2.5 py-1.5 text-sm hover:bg-[var(--hover)]"
        >
          Go
        </button>
        {count > 0 && (
          <button onClick={clearAll} className="rounded border border-[var(--border)] px-2.5 py-1.5 text-sm hover:bg-[var(--hover)]">
            Clear
          </button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} />
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> Photos
        </label>
      </div>
      <div ref={containerRef} className="h-72 w-full rounded-lg overflow-hidden border border-[var(--border)] z-0" />
      <p className="text-[11px] text-[var(--muted)] mt-1.5">
        {count === 0
          ? "Use the polygon tool (top-right) to draw one or more regions. Photos are kept only if their GPS is inside a region."
          : `${count} region${count === 1 ? "" : "s"} drawn — photos must fall inside one of them.`}
        {showPhotos && total != null && (
          <>
            {" "}
            {total === 0
              ? "No geotagged photos in the selected albums."
              : matched != null
                ? `${matched} of ${total} geotagged photos fall inside${total > points.length ? " (of first " + points.length + " shown)" : ""}.`
                : `Showing ${total} geotagged photo${total === 1 ? "" : "s"}${total > points.length ? ` (first ${points.length} shown)` : ""}.`}
          </>
        )}
      </p>
    </div>
  );
}

/** Ray-casting point-in-polygon over [lat, lng] rings — mirrors the server's test so the
 * preview count matches what the backend will actually select. */
function pointInAnyPolygon(lat: number, lng: number, polygons: Ring[]): boolean {
  return polygons.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  });
}
