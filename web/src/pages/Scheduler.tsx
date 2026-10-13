import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eraser, Check, Pencil } from "lucide-react";
import { apiGet, apiSend, type Schedule, type ScheduleEntry, type Profile } from "../api/client.ts";
import { PageHeader, Card, Button } from "../components/ui.tsx";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

function hourLabel(h: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

export function Scheduler() {
  const qc = useQueryClient();
  const schedules = useQuery({ queryKey: ["schedules"], queryFn: () => apiGet<Schedule[]>("/api/schedules") });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => apiGet<Profile[]>("/api/profiles") });
  const [schedId, setSchedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [tempName, setTempName] = useState("");

  // Keep a valid selection: pick the first schedule whenever the current id is missing or no
  // longer exists (e.g. right after deleting the selected schedule).
  useEffect(() => {
    if (schedules.data && !schedules.data.some((s) => s.id === schedId)) {
      setSchedId(schedules.data[0]?.id ?? null);
    }
  }, [schedules.data, schedId]);

  const current = schedules.data?.find((s) => s.id === schedId) ?? null;

  async function newSchedule() {
    const s = await apiSend<Schedule>("POST", "/api/schedules", { name: `Schedule ${(schedules.data?.length ?? 0) + 1}` });
    await qc.invalidateQueries({ queryKey: ["schedules"] });
    setSchedId(s.id);
  }
  async function removeSchedule(id: string) {
    await apiSend("DELETE", `/api/schedules/${id}`);
    setSchedId(null);
    qc.invalidateQueries({ queryKey: ["schedules"] });
  }
  async function rename() {
    if (schedId && tempName.trim()) await apiSend("PATCH", `/api/schedules/${schedId}`, { name: tempName.trim() });
    setRenaming(false);
    qc.invalidateQueries({ queryKey: ["schedules"] });
  }

  const colorOf = (pid: string) => COLORS[(profiles.data?.findIndex((p) => p.id === pid) ?? 0) % COLORS.length];

  return (
    <div>
      <PageHeader
        title="Scheduler"
        subtitle="Paint a profile onto each hour. Assign a schedule to a device under Devices."
        actions={
          <Button onClick={newSchedule}>
            <Plus size={15} /> New schedule
          </Button>
        }
      />

      {schedules.data?.length === 0 && <Card>Create a schedule to begin.</Card>}

      {current && (
        <div className="flex items-center gap-2 mb-4">
          {renaming ? (
            <>
              <input
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && rename()}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
              />
              <Button onClick={rename}>
                <Check size={14} /> Save
              </Button>
            </>
          ) : (
            <>
              <select
                value={schedId ?? ""}
                onChange={(e) => setSchedId(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
              >
                {schedules.data?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  setTempName(current.name);
                  setRenaming(true);
                }}
                className="text-[var(--muted)] hover:text-[var(--text)]"
                title="Rename"
              >
                <Pencil size={15} />
              </button>
            </>
          )}
          <div className="flex-1" />
          <Button variant="danger" onClick={() => removeSchedule(current.id)}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      )}

      {schedId && profiles.data && <Calendar scheduleId={schedId} profiles={profiles.data} colorOf={colorOf} />}
    </div>
  );
}

function Calendar({
  scheduleId,
  profiles,
  colorOf,
}: {
  scheduleId: string;
  profiles: Profile[];
  colorOf: (pid: string) => string;
}) {
  const qc = useQueryClient();
  const entries = useQuery({
    queryKey: ["schedule-entries", scheduleId],
    queryFn: () => apiGet<ScheduleEntry[]>(`/api/schedules/${scheduleId}/entries`),
  });
  const [brush, setBrush] = useState<string | null>(profiles[0]?.id ?? null);
  const [cells, setCells] = useState<Record<string, string>>({});
  const painting = useRef(false);

  const today = new Date();
  const todayDow = today.getDay();
  const nowHour = today.getHours();

  useEffect(() => {
    const map: Record<string, string> = {};
    entries.data?.forEach((e) => (map[`${e.dow}-${e.hour}`] = e.profile_id));
    setCells(map);
  }, [entries.data]);

  useEffect(() => {
    const up = () => (painting.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  function paint(dow: number, hour: number) {
    const key = `${dow}-${hour}`;
    const value = brush;
    setCells((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    apiSend("PUT", `/api/schedules/${scheduleId}/cell`, { dow, hour, profileId: value }).then(() =>
      qc.invalidateQueries({ queryKey: ["stats"] }),
    );
  }

  if (profiles.length === 0) return <Card>Create a profile first — schedules assign profiles to hours.</Card>;
  const nameOf = (pid: string) => profiles.find((p) => p.id === pid)?.name ?? "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-[var(--muted)] mr-1">Profile:</span>
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setBrush(p.id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border transition-all ${
              brush === p.id ? "border-[var(--text)]" : "border-transparent"
            }`}
            style={{ background: colorOf(p.id) + "26" }}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorOf(p.id) }} />
            {p.name}
          </button>
        ))}
        <button
          onClick={() => setBrush(null)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border ${
            brush === null ? "border-[var(--text)]" : "border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          <Eraser size={12} /> Erase
        </button>
      </div>

      <Card className="p-0 overflow-hidden select-none">
        {/* Header */}
        <div className="grid border-b border-[var(--border)] bg-[var(--panel-muted)]" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
          <div className="border-r border-[var(--border)]" />
          {DAYS.map((d, i) => (
            <div
              key={d}
              className={`text-center text-xs font-semibold py-2 border-r border-[var(--border)] last:border-r-0 ${
                i === todayDow ? "text-blue-500" : "text-[var(--muted)]"
              }`}
            >
              {d}
              {i === todayDow && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 align-middle" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="grid" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
          {HOURS.map((h) => (
            <div key={h} className="contents">
              <div className="h-7 pr-2 text-[10px] text-[var(--muted)] flex items-start justify-end -mt-1.5 border-r border-[var(--border)]">
                {hourLabel(h)}
              </div>
              {DAYS.map((_, dow) => {
                const pid = cells[`${dow}-${h}`];
                const above = cells[`${dow}-${h - 1}`];
                const below = cells[`${dow}-${h + 1}`];
                const runStart = pid && above !== pid;
                const runEnd = pid && below !== pid;
                const isNow = dow === todayDow && h === nowHour;
                const business = h >= 8 && h <= 18;
                return (
                  <div
                    key={dow}
                    onMouseDown={() => {
                      painting.current = true;
                      paint(dow, h);
                    }}
                    onMouseEnter={() => painting.current && paint(dow, h)}
                    title={pid ? nameOf(pid) : `${hourLabel(h)} ${DAYS[dow]}`}
                    className={`relative h-7 px-1 cursor-pointer border-r border-[var(--border)] last:border-r-0 ${
                      pid && above === pid ? "" : "border-t border-[var(--border)]"
                    } ${!pid ? "hover:bg-[var(--hover)]" : ""}`}
                    style={{
                      background: pid ? colorOf(pid) : business ? "var(--panel)" : "var(--panel-muted)",
                    }}
                  >
                    {isNow && <span className="absolute left-0 right-0 top-0 h-[2px] bg-red-500" />}
                    {runStart && (
                      <span className="text-[10px] font-medium text-white leading-7 truncate block drop-shadow">
                        {nameOf(pid!)}
                      </span>
                    )}
                    {pid && runEnd && <span className="absolute inset-x-1 bottom-0 h-px bg-black/10" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
      <p className="text-xs text-[var(--muted)] mt-2">Click or drag to paint. Empty hours fall back to the device's default profile.</p>
    </div>
  );
}
