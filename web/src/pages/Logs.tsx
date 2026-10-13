import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { apiGet, relativeTime, type DeviceRequest, type Device } from "../api/client.ts";
import { PageHeader, Card, Badge } from "../components/ui.tsx";

function statusTone(status: number | null): "green" | "amber" | "red" | "slate" {
  if (status == null) return "slate";
  if (status >= 500) return "red";
  if (status === 304) return "amber";
  if (status >= 200 && status < 300) return "green";
  return "slate";
}

export function Logs() {
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => apiGet<Device[]>("/api/devices") });
  const [deviceId, setDeviceId] = useState<string>("");
  const [openId, setOpenId] = useState<number | null>(null);

  const reqs = useQuery({
    queryKey: ["device-requests", deviceId],
    queryFn: () =>
      apiGet<DeviceRequest[]>(`/api/device-requests?limit=300${deviceId ? `&deviceId=${deviceId}` : ""}`),
    refetchInterval: 15000,
  });

  const nameOf = (id: string | null) => devices.data?.find((d) => d.id === id)?.name ?? id ?? "—";

  return (
    <div>
      <PageHeader title="Logs" subtitle="Incoming requests from the frames — every image fetch, including cached (304) hits. Click a row for the raw request." />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-sm"
        >
          <option value="">All frames</option>
          {devices.data?.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <span className="text-xs text-[var(--muted)]">{reqs.data?.length ?? 0} requests</span>
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--border)]">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Frame</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Image</th>
              <th className="px-4 py-2 font-medium">Battery</th>
              <th className="px-4 py-2 font-medium">Firmware</th>
              <th className="px-4 py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {reqs.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[var(--muted)]">
                  No device requests yet — they'll appear here the next time a frame fetches an image.
                </td>
              </tr>
            )}
            {reqs.data?.map((e) => (
              <Fragment key={e.id}>
                <tr
                  className="border-b border-[var(--border)]/50 last:border-0 cursor-pointer hover:bg-[var(--hover)]"
                  onClick={() => setOpenId((id) => (id === e.id ? null : e.id))}
                >
                  <td className="px-4 py-2 text-[var(--muted)] whitespace-nowrap" title={new Date(e.created_at).toLocaleString()}>
                    <ChevronRight size={13} className={`inline mr-1 transition-transform ${openId === e.id ? "rotate-90" : ""}`} />
                    {relativeTime(e.created_at)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{nameOf(e.device_id)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Badge tone={statusTone(e.status)}>
                      {e.status ?? "—"}{e.not_modified ? " (cached)" : ""}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-[var(--muted)] truncate max-w-[14rem]" title={e.asset_id ?? ""}>
                    {e.asset_id ?? "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {e.battery_pct != null ? `${Math.round(e.battery_pct)}%` : "—"}
                    {e.battery_mv != null ? ` · ${(e.battery_mv / 1000).toFixed(2)}V` : ""}
                  </td>
                  <td className="px-4 py-2 text-[var(--muted)] whitespace-nowrap">{e.firmware ?? "—"}</td>
                  <td className="px-4 py-2 text-[var(--muted)] whitespace-nowrap">{e.ip ?? "—"}</td>
                </tr>
                {openId === e.id && (
                  <tr className="border-b border-[var(--border)]/50 last:border-0">
                    <td colSpan={7} className="px-4 py-3 bg-[var(--panel-muted)]">
                      <pre className="text-xs whitespace-pre-wrap break-all font-mono text-[var(--text)]">
                        {e.raw ?? "Raw request not recorded for this entry."}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
