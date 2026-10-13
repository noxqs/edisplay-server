import { useQuery } from "@tanstack/react-query";
import { Card, Chip, Spinner } from "@heroui/react";
import { apiGet, type ImmichStatus, type Stats, type GeminiConfig } from "../api/client.ts";
import { PageHeader } from "../components/ui.tsx";
import { DeviceManager } from "../components/DeviceManager.tsx";

interface TelegramStatusView {
  status: { running: boolean; username?: string };
}

export function Dashboard() {
  const immich = useQuery({ queryKey: ["immich-status"], queryFn: () => apiGet<ImmichStatus>("/api/immich/status") });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => apiGet<Stats>("/api/stats"), refetchInterval: 15000 });
  const telegram = useQuery({ queryKey: ["telegram"], queryFn: () => apiGet<TelegramStatusView>("/api/telegram"), refetchInterval: 15000 });
  const gemini = useQuery({ queryKey: ["gemini-config"], queryFn: () => apiGet<GeminiConfig>("/api/gemini/config") });

  const tg = telegram.data?.status;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="What each frame is showing right now." />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
        {/* Left: status / settings */}
        <Card className="overflow-hidden p-0">
          <StatRow label="Immich">
            {immich.isLoading ? <Spinner size="sm" /> : immich.data?.ok ? <Chip size="sm" variant="soft" color="success">connected</Chip> : <Chip size="sm" variant="soft" color="danger">offline</Chip>}
          </StatRow>
          <StatRow label="Telegram">
            {telegram.isLoading ? (
              <Spinner size="sm" />
            ) : tg?.running ? (
              <Chip size="sm" variant="soft" color="success">{tg.username ? `@${tg.username}` : "running"}</Chip>
            ) : (
              <Chip size="sm" variant="soft" color="default">off</Chip>
            )}
          </StatRow>
          <StatRow label="Gemini (GenAI)">
            {gemini.isLoading ? <Spinner size="sm" /> : gemini.data?.hasApiKey ? <Chip size="sm" variant="soft" color="success">key set</Chip> : <Chip size="sm" variant="soft" color="default">no key</Chip>}
          </StatRow>
          <StatRow label="Frames online">
            <span className="font-semibold">
              {stats.data?.framesOnline ?? 0}
              <span className="text-[var(--muted)] font-normal">/{stats.data?.frames ?? 0}</span>
            </span>
          </StatRow>
          <StatRow label="Photos available">
            <span className="font-semibold">{stats.data?.available?.toLocaleString() ?? 0}</span>
          </StatRow>
          <StatRow label="Images shown (24h)">
            <span className="font-semibold">{stats.data?.shows24h ?? 0}</span>
          </StatRow>
          <StatRow label="Errors (24h)" last>
            <span className={`font-semibold ${stats.data?.errors24h ? "text-red-500" : ""}`}>{stats.data?.errors24h ?? 0}</span>
          </StatRow>
        </Card>

        {/* Right: frames */}
        <DeviceManager />
      </div>
    </div>
  );
}

function StatRow({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${last ? "" : "border-b border-[var(--border)]"}`}>
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
