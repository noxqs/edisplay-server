import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sun, Moon, Clock, Server, Bot, Download, Upload, AlertTriangle } from "lucide-react";
import {
  apiGet,
  apiSend,
  type ImmichStatus,
  type ImmichConfig,
  type OAuthProviderStatus,
  type GeminiConfig,
} from "../api/client.ts";
import { PageHeader, Card, Badge, Button } from "../components/ui.tsx";
import { useTheme, type Theme } from "../theme.ts";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <PageHeader title="Settings" subtitle="Global configuration not covered by another tab." />

      <Card className="p-0 divide-y divide-[var(--border)] max-w-2xl">
        <section className="px-4 py-3">
          <div className="font-medium mb-2">Appearance</div>
          <Row label="Theme">
            <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
              <ThemeBtn current={theme} value="light" onClick={setTheme} icon={<Sun size={15} />} label="Day" />
              <ThemeBtn current={theme} value="dark" onClick={setTheme} icon={<Moon size={15} />} label="Night" />
            </div>
          </Row>
        </section>

        <LocationTimeCard />

        <ImmichCard />

        <AIProvidersCard />

        <section className="px-4 py-3">
          <div className="font-medium mb-2">Conversion defaults</div>
          <Row label="Panel">1200 × 1600 (portrait)</Row>
          <Row label="Palette">Spectra 6</Row>
          <Row label="Preset">balanced</Row>
        </section>

        <BackupRestore />

        <MaintenanceCard />
      </Card>
    </div>
  );
}

function MaintenanceCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const restart = useMutation({
    mutationFn: () => apiSend("POST", "/api/reload", {}),
    onSuccess: () => setMsg("Rebuilding — the backend will restart in ~1 min if the build passes (page will reconnect)."),
    onError: () => setMsg("Couldn't trigger a restart."),
  });
  return (
    <section className="px-4 py-3">
      <div className="font-medium mb-2">Maintenance</div>
      <Row label="Backend">
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm("Rebuild and restart the backend? It will be offline for ~1 minute.")) restart.mutate();
          }}
          disabled={restart.isPending}
        >
          Restart backend
        </Button>
      </Row>
      <p className="text-xs text-[var(--muted)] mt-1">
        Rebuilds from the synced source and restarts. If the build fails it stays on the current version.
      </p>
      {msg && <p className="text-xs text-[var(--muted)] mt-1">{msg}</p>}
    </section>
  );
}

function ImmichCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["immich-status"], queryFn: () => apiGet<ImmichStatus>("/api/immich/status") });
  const config = useQuery({ queryKey: ["immich-config"], queryFn: () => apiGet<ImmichConfig>("/api/immich/config") });

  // null = "follow the saved value"; a string = user is editing.
  const [url, setUrl] = useState<string | null>(null);
  const [key, setKey] = useState("");

  const save = useMutation({
    mutationFn: () =>
      apiSend<{ status: ImmichStatus }>("PUT", "/api/immich/config", {
        baseUrl: url ?? config.data?.baseUrl ?? "",
        apiKey: key,
      }),
    onSuccess: () => {
      setUrl(null);
      setKey("");
      qc.invalidateQueries({ queryKey: ["immich-status"] });
      qc.invalidateQueries({ queryKey: ["immich-config"] });
      qc.invalidateQueries({ queryKey: ["albums"] });
    },
  });

  const urlValue = url ?? config.data?.baseUrl ?? "";
  const hasKey = config.data?.hasApiKey ?? false;
  const inputCls =
    "w-full rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm font-mono";

  return (
    <section className="px-4 py-3">
      <div className="font-medium mb-2 flex items-center gap-2">
        <Server size={16} /> Immich connection
      </div>

      <Row label="Status">
        {status.data?.ok ? <Badge tone="green">connected</Badge> : <Badge tone="red">disconnected</Badge>}
      </Row>
      <Row label="Version">{status.data?.version ?? "—"}</Row>
      {!status.data?.ok && status.data?.error && (
        <p className="text-xs text-red-500 py-1.5">{status.data.error}</p>
      )}

      <div className="py-2 space-y-1">
        <label className="text-sm text-[var(--muted)]">Server URL</label>
        <input
          value={urlValue}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://immich.local:2283"
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="py-2 space-y-1">
        <label className="text-sm text-[var(--muted)]">API key</label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? "•••••••• (leave blank to keep current)" : "paste your Immich API key"}
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center gap-3 mt-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save & test"}
        </Button>
        {save.isSuccess && (
          <span className="text-xs text-[var(--muted)]">
            {save.data?.status?.ok ? "Connected ✓" : `Saved, but ${save.data?.status?.error ?? "could not connect"}`}
          </span>
        )}
        {save.isError && <span className="text-xs text-red-500">Save failed.</span>}
      </div>

      <p className="text-xs text-[var(--muted)] mt-3">
        Create an API key in Immich under Account Settings → API Keys. The key is stored on the server and never shown
        again here.
      </p>
    </section>
  );
}

function AIProvidersCard() {
  const qc = useQueryClient();
  const inputCls =
    "w-full rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm font-mono";

  // Gemini — API key (Google AI Studio), stored like the Immich key.
  const gemini = useQuery({ queryKey: ["gemini-config"], queryFn: () => apiGet<GeminiConfig>("/api/gemini/config") });
  const [geminiKey, setGeminiKey] = useState("");
  const saveGemini = useMutation({
    mutationFn: () => apiSend<GeminiConfig>("PUT", "/api/gemini/config", { apiKey: geminiKey }),
    onSuccess: () => {
      setGeminiKey("");
      qc.invalidateQueries({ queryKey: ["gemini-config"] });
    },
  });

  // Claude — OAuth, so inference runs against the user's Claude plan (not metered API billing).
  const providers = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: () => apiGet<OAuthProviderStatus[]>("/api/oauth/providers"),
  });
  const claude = providers.data?.find((p) => p.provider === "anthropic");
  const disconnect = useMutation({
    mutationFn: () => apiSend("POST", "/api/oauth/anthropic/disconnect"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oauth-providers"] }),
  });

  // Surface the ?oauth=anthropic&status=... the callback redirected back with.
  const params = new URLSearchParams(window.location.search);
  const cbStatus = params.get("oauth") === "anthropic" ? params.get("status") : null;
  const cbMessage = params.get("message");

  return (
    <section className="px-4 py-3">
      <div className="font-medium mb-2 flex items-center gap-2">
        <Bot size={16} /> AI providers
      </div>

      {/* Gemini */}
      <Row label="Gemini (Google AI)">
        {gemini.data?.hasApiKey ? <Badge tone="green">key set</Badge> : <Badge tone="red">no key</Badge>}
      </Row>
      <div className="py-2 space-y-1">
        <label className="text-sm text-[var(--muted)]">API key</label>
        <input
          type="password"
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          placeholder={gemini.data?.hasApiKey ? "•••••••• (leave blank to keep current)" : "paste your Google AI Studio key"}
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={() => saveGemini.mutate()} disabled={saveGemini.isPending || !geminiKey.trim()}>
            {saveGemini.isPending ? "Saving…" : "Save"}
          </Button>
          {saveGemini.isSuccess && <span className="text-xs text-[var(--muted)]">Saved ✓</span>}
        </div>
      </div>

      {/* Claude */}
      <Row label="Claude (Anthropic plan)">
        <div className="flex items-center gap-2">
          {!claude?.configured ? (
            <Badge tone="amber">not configured</Badge>
          ) : claude.connected ? (
            <>
              {claude.account && <span className="text-xs text-[var(--muted)]">{claude.account}</span>}
              <Badge tone="green">connected</Badge>
              <Button variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <Badge tone="red">disconnected</Badge>
              <Button onClick={() => (window.location.href = "/api/oauth/anthropic/start")}>Connect</Button>
            </>
          )}
        </div>
      </Row>
      {cbStatus && (
        <p className={`text-xs py-1.5 ${cbStatus === "connected" ? "text-green-600" : "text-red-500"}`}>
          {cbStatus === "connected"
            ? "Connected Claude ✓"
            : `Could not connect Claude${cbMessage ? `: ${cbMessage}` : ""}`}
        </p>
      )}

      <p className="text-xs text-[var(--muted)] mt-3">
        Gemini uses a Google AI Studio API key (powers image generation). Claude connects via OAuth so inference runs
        against your Claude plan rather than metered API billing — set <code>ANTHROPIC_OAUTH_CLIENT_ID</code> in the
        server env to enable Connect (it shows “not configured” until then). Spend appears on the Usage → AI Cost tab.
      </p>
    </section>
  );
}

interface AppSettings {
  weatherLocation: string;
  weatherUnits: "C" | "F";
  timezone: string;
}

function LocationTimeCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["app-settings"], queryFn: () => apiGet<AppSettings>("/api/app-settings") });
  const save = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => apiSend("PUT", "/api/app-settings", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings"] }),
  });

  const s = settings.data;
  const tzList: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <section className="px-4 py-3">
      <div className="font-medium mb-2 flex items-center gap-2">
        <Clock size={16} /> Time
      </div>

      <Row label="Timezone">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-[var(--muted)]" />
          <select
            value={s?.timezone ?? ""}
            onChange={(e) => save.mutate({ timezone: e.target.value })}
            className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 text-sm max-w-[16rem]"
          >
            <option value="">Server default</option>
            {browserTz && !tzList.includes(browserTz) && <option value={browserTz}>{browserTz}</option>}
            {tzList.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          {s?.timezone !== browserTz && (
            <Button variant="ghost" onClick={() => save.mutate({ timezone: browserTz })}>
              Use this device's ({browserTz})
            </Button>
          )}
        </div>
      </Row>
      <p className="text-xs text-[var(--muted)] mt-2">Timezone is used by the scheduler to pick the right profile per hour.</p>
    </section>
  );
}

function BackupRestore() {
  const [exportPw, setExportPw] = useState("");
  const [importPw, setImportPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function doExport() {
    setBusy(true);
    try {
      const res = await fetch("/api/config/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: exportPw || undefined }),
      });
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "photoframe-backup.pfb";
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ text: exportPw ? "Exported (encrypted)." : "Exported.", ok: true });
    } finally {
      setBusy(false);
    }
  }

  async function doImport(file: File) {
    if (!confirm("Import REPLACES all current config and restarts the server. Continue?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/config/import", {
        method: "POST",
        headers: importPw ? { "X-Backup-Password": importPw } : {},
        body: await file.arrayBuffer(),
      });
      const data = await res.json().catch(() => ({}));
      setMsg({ text: res.ok ? "Imported — server restarting, refresh in a moment." : data.error || "Import failed", ok: res.ok });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="px-4 py-3">
      <div className="font-medium mb-2">Backup &amp; restore</div>

      <div className="flex items-start gap-2 text-[11px] text-amber-600 mb-3">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          A backup contains <b>all your tokens and keys</b> (Immich, Telegram, frame tokens, OAuth). Anyone with the
          file — and its password — has full access. Set a password and <b>keeping the file safe is your responsibility</b>.
          An encrypted backup can't be recovered without its password.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="text-xs text-[var(--muted)]">
          <div className="mb-1">Export password (optional)</div>
          <input
            type="password"
            value={exportPw}
            onChange={(e) => setExportPw(e.target.value)}
            placeholder="leave blank for none"
            className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm"
          />
        </label>
        <Button onClick={doExport} disabled={busy}>
          <Download size={15} /> Export
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          <div className="mb-1">Import password (if encrypted)</div>
          <input
            type="password"
            value={importPw}
            onChange={(e) => setImportPw(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1.5 text-sm"
          />
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".pfb"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
        />
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={15} /> Import…
        </Button>
      </div>

      {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</p>}
    </section>
  );
}

function ThemeBtn({
  current,
  value,
  onClick,
  icon,
  label,
}: {
  current: Theme;
  value: Theme;
  onClick: (t: Theme) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-blue-600 text-white" : "text-[var(--muted)] hover:bg-[var(--hover)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm border-b border-[var(--border)] last:border-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span>{children}</span>
    </div>
  );
}
