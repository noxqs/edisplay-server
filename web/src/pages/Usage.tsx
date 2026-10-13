import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { apiGet, relativeTime, type UsageEvent, type Device, type GenaiCost } from "../api/client.ts";
import { PageHeader, Card, Badge } from "../components/ui.tsx";

const TYPES = [
  { value: "", label: "All" },
  { value: "show", label: "Showing" },
  { value: "error", label: "Errors" },
  { value: "battery", label: "Battery" },
  { value: "genai", label: "AI Cost" },
] as const;

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export function Usage() {
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => apiGet<Device[]>("/api/devices") });
  const [deviceId, setDeviceId] = useState<string>("");
  const [type, setType] = useState<string>("");

  const events = useQuery({
    queryKey: ["usage", deviceId, type],
    queryFn: () =>
      apiGet<UsageEvent[]>(
        `/api/usage?limit=200${deviceId ? `&deviceId=${deviceId}` : ""}${type ? `&type=${type}` : ""}`,
      ),
    refetchInterval: 15000,
  });
  const battery = useQuery({
    queryKey: ["battery", deviceId],
    queryFn: () => apiGet<Array<{ t: number; battery: number }>>(`/api/usage/battery/${deviceId}`),
    enabled: !!deviceId,
    refetchInterval: 15000,
  });
  const cost = useQuery({
    queryKey: ["genai-cost"],
    queryFn: () => apiGet<GenaiCost>("/api/usage/genai-cost?days=30"),
    enabled: type === "genai",
    refetchInterval: 15000,
  });

  const nameOf = (id: string | null) => devices.data?.find((d) => d.id === id)?.name ?? id ?? "—";
  const isGenai = type === "genai";

  return (
    <div>
      <PageHeader
        title="Usage"
        subtitle={isGenai ? "AI generation spend (last 30 days)." : "Activity, errors and battery."}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    type === t.value ? "bg-blue-600 text-white" : "text-[var(--muted)] hover:bg-[var(--hover)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {!isGenai && (
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
              >
                <option value="">All frames</option>
                {devices.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        }
      />

      {isGenai && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Card>
              <div className="text-xs text-[var(--muted)]">Total spend (30d)</div>
              <div className="text-2xl font-semibold mt-1">{usd(cost.data?.totalUsd ?? 0)}</div>
            </Card>
            <Card>
              <div className="text-xs text-[var(--muted)] mb-2">By provider</div>
              {cost.data?.byProvider.length ? (
                cost.data.byProvider.map((p) => (
                  <div key={p.provider} className="flex justify-between text-sm py-0.5">
                    <span className="text-[var(--muted)]">{p.provider}</span>
                    <span>{usd(p.costUsd)}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-[var(--muted)]">—</div>
              )}
            </Card>
            <Card>
              <div className="text-xs text-[var(--muted)] mb-2">By model</div>
              {cost.data?.byModel.length ? (
                cost.data.byModel.map((m) => (
                  <div key={m.model} className="flex justify-between text-sm py-0.5">
                    <span className="text-[var(--muted)] truncate max-w-[10rem]">{m.model}</span>
                    <span>{usd(m.costUsd)}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-[var(--muted)]">—</div>
              )}
            </Card>
          </div>
          <Card className="mb-4">
            <div className="text-sm font-medium mb-3">Daily cost</div>
            {cost.data && cost.data.series.length > 1 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={cost.data.series} margin={{ left: -20, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" })}
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => usd(v as number)} />
                  <Tooltip
                    labelFormatter={(t) => new Date(t as number).toLocaleDateString()}
                    formatter={(v) => [usd(v as number), "cost"]}
                  />
                  <Line type="monotone" dataKey="cost" stroke="#3b82f6" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-[var(--muted)]">No AI usage yet. Connect a provider under Settings → AI providers.</p>
            )}
          </Card>
        </>
      )}

      {!isGenai && deviceId && (
        <Card className="mb-4">
          <div className="text-sm font-medium mb-3">Battery — {nameOf(deviceId)}</div>
          {battery.data && battery.data.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={battery.data} margin={{ left: -20, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString()}
                  formatter={(v) => [`${v}%`, "battery"]}
                />
                <Line type="monotone" dataKey="battery" stroke="#22c55e" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-[var(--muted)]">Not enough battery readings yet.</p>
          )}
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-2 font-medium">When</th>
              {isGenai ? (
                <>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Tokens</th>
                  <th className="px-4 py-2 font-medium">Cost</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-2 font-medium">Frame</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Detail</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {events.data?.length === 0 && (
              <tr>
                <td colSpan={isGenai ? 5 : 4} className="px-4 py-6 text-center text-[var(--muted)]">
                  {isGenai ? "No AI usage yet." : "No activity yet."}
                </td>
              </tr>
            )}
            {events.data?.map((e) => (
              <tr key={e.id} className="border-b border-[var(--border)]/50 last:border-0">
                <td className="px-4 py-2 text-[var(--muted)] whitespace-nowrap">{relativeTime(e.created_at)}</td>
                {isGenai ? (
                  <>
                    <td className="px-4 py-2 whitespace-nowrap">{e.provider ?? "—"}</td>
                    <td className="px-4 py-2 text-[var(--muted)] truncate max-w-xs">{e.model ?? "—"}</td>
                    <td className="px-4 py-2 text-[var(--muted)] whitespace-nowrap">
                      {e.input_tokens != null || e.output_tokens != null
                        ? `${e.input_tokens ?? 0} in / ${e.output_tokens ?? 0} out`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{e.cost_usd != null ? usd(e.cost_usd) : "unpriced"}</td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2 whitespace-nowrap">{nameOf(e.device_id)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={e.type === "error" ? "red" : e.type === "battery" ? "amber" : "green"}>{e.type}</Badge>
                    </td>
                    <td className="px-4 py-2 text-[var(--muted)] truncate max-w-xs">
                      {e.type === "error" ? e.message : e.type === "battery" ? `${e.battery_pct}%` : e.asset_id}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
