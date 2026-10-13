import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Plus, Check, Trash2, UserPlus, Users, MessageSquare } from "lucide-react";
import { apiGet, apiSend, type Album } from "../api/client.ts";
import { PageHeader, Card, Button, Badge } from "../components/ui.tsx";

interface BotInfo {
  id: number;
  name: string;
  username?: string;
  canJoinGroups?: boolean;
  canReadAllGroupMessages?: boolean;
  supportsInline?: boolean;
}
interface RecentSender {
  id: number;
  name: string;
  at: number;
}
interface TelegramStatus {
  running: boolean;
  username?: string;
  info?: BotInfo;
  received: number;
  lastAt?: number;
  lastError?: string;
  recentSenders: RecentSender[];
}
interface AllowedUser {
  id: number;
  name?: string;
}
interface TelegramConfig {
  enabled: boolean;
  targetAlbumId: string | null;
  hasToken: boolean;
  tokenMasked: string | null;
  allowedUsers: AllowedUser[];
  status: TelegramStatus;
}
interface TgMessage {
  id: number;
  user_id: number;
  user_name: string;
  direction: "in" | "out";
  text: string;
  at: number;
}
interface TgThread {
  userId: number;
  userName: string;
  lastAt: number;
  messages: TgMessage[];
}

export function Telegram() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["telegram"], queryFn: () => apiGet<TelegramConfig>("/api/telegram"), refetchInterval: 5000 });
  const albums = useQuery({ queryKey: ["albums"], queryFn: () => apiGet<Album[]>("/api/albums") });
  const threads = useQuery({ queryKey: ["telegram-messages"], queryFn: () => apiGet<TgThread[]>("/api/telegram/messages"), refetchInterval: 5000 });
  const [token, setToken] = useState("");
  const [newAlbum, setNewAlbum] = useState("");

  const authorize = useMutation({
    mutationFn: (u: AllowedUser) => apiSend("POST", "/api/telegram/authorize", u),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telegram"] }),
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => apiSend("PUT", "/api/telegram", patch),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["telegram"] });
    },
  });
  const createAlbum = useMutation({
    mutationFn: () => apiSend<{ id: string }>("POST", "/api/immich/albums", { name: newAlbum.trim() }),
    onSuccess: (a) => {
      setNewAlbum("");
      qc.invalidateQueries({ queryKey: ["albums"] });
      save.mutate({ targetAlbumId: a.id });
    },
  });

  const t = cfg.data;
  const st = t?.status;
  const allowed = t?.allowedUsers ?? [];
  const pending = (threads.data ?? []).filter((th) => !allowed.some((u) => u.id === th.userId));
  const Info = ({ label, value }: { label: string; value: string }) => (
    <div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Telegram" subtitle="Send photos to your bot and they land in Immich." />

      <div className="max-w-2xl space-y-4">
        {/* Status */}
        <Card>
          <div className="flex items-center justify-between">
            <div className="font-medium">Bot status</div>
            {st?.running ? <Badge tone="green">● running</Badge> : <Badge tone="slate">● stopped</Badge>}
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
            <Info label="Bot" value={st?.username ? `@${st.username}` : "—"} />
            <Info label="Received" value={String(st?.received ?? 0)} />
            <Info label="Last" value={st?.lastAt ? new Date(st.lastAt).toLocaleTimeString() : "—"} />
          </div>
          {st?.lastError && <p className="text-xs text-red-500 mt-2">{st.lastError}</p>}

          {st?.info && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="text-xs font-semibold text-[var(--muted)] mb-2">ABOUT THIS BOT</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Info label="Name" value={st.info.name} />
                <Info label="Username" value={st.info.username ? `@${st.info.username}` : "—"} />
                <Info label="Bot ID" value={String(st.info.id)} />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {st.info.canJoinGroups && <Badge tone="slate">can join groups</Badge>}
                {st.info.canReadAllGroupMessages && <Badge tone="slate">reads all group messages</Badge>}
                {st.info.supportsInline && <Badge tone="slate">inline queries</Badge>}
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-2">Telegram's Bot API doesn't expose the bot's owner.</p>
            </div>
          )}

          {/* Target album — where uploaded photos land */}
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <div className="font-medium mb-2">Target Immich album</div>
            <select
              value={t?.targetAlbumId ?? ""}
              onChange={(e) => save.mutate({ targetAlbumId: e.target.value || null })}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm mb-3"
            >
              <option value="">— none —</option>
              {albums.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.assetCount})
                </option>
              ))}
            </select>
            <div className="text-xs text-[var(--muted)] mb-1.5">Or create a new Immich album</div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newAlbum.trim()) createAlbum.mutate();
              }}
            >
              <input
                value={newAlbum}
                onChange={(e) => setNewAlbum(e.target.value)}
                placeholder="e.g. Frame uploads"
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
              />
              <Button type="submit" disabled={!newAlbum.trim() || createAlbum.isPending}>
                <Plus size={15} /> Create
              </Button>
            </form>
          </div>
        </Card>

        {/* Bot token */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium flex items-center gap-2">
              <Send size={16} /> Bot
            </div>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!t?.enabled} onChange={(e) => save.mutate({ enabled: e.target.checked })} />
              Enabled
            </label>
          </div>

          {t?.tokenMasked && (
            <div className="mb-2">
              <div className="text-xs text-[var(--muted)] mb-1">Current token</div>
              <code className="block text-sm bg-[var(--panel-muted)] rounded px-2 py-1.5 tracking-wide">{t.tokenMasked}</code>
            </div>
          )}
          <div className="text-xs text-[var(--muted)] mb-1.5">{t?.hasToken ? "Replace token" : "Bot token"}</div>
          <div className="flex gap-2">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="123456:ABC-DEF…"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm outline-none focus:border-blue-500"
            />
            <Button onClick={() => token.trim() && save.mutate({ botToken: token.trim() })} disabled={!token.trim()}>
              <Check size={15} /> Save
            </Button>
          </div>
          <p className="text-xs text-[var(--muted)] mt-2">Create a bot with @BotFather and paste its token.</p>
        </Card>

        {/* Authorized users */}
        <AuthorizedUsers
          allowed={allowed}
          pending={pending}
          onAuthorize={(u) => authorize.mutate(u)}
          onChange={(allowedUsers) => save.mutate({ allowedUsers })}
        />

        {/* Chat history */}
        <ChatHistory threads={threads.data ?? []} />
      </div>
    </div>
  );
}

function AuthorizedUsers({
  allowed,
  pending,
  onAuthorize,
  onChange,
}: {
  allowed: AllowedUser[];
  pending: TgThread[];
  onAuthorize: (u: AllowedUser) => void;
  onChange: (list: AllowedUser[]) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const has = (uid: number) => allowed.some((u) => u.id === uid);

  return (
    <Card>
      <div className="font-medium flex items-center gap-2 mb-1">
        <Users size={16} /> Authorized users
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">
        Only authorized users can upload. When someone new messages the bot they appear below as
        pending — click Authorize and they'll get a confirmation.
      </p>

      {pending.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-amber-600 mb-2">PENDING REQUESTS</div>
          <div className="space-y-1.5">
            {pending.map((p) => (
              <div key={p.userId} className="flex items-center gap-2 text-sm rounded-lg bg-amber-500/10 px-2.5 py-1.5">
                <span className="flex-1">
                  {p.userName} <span className="text-xs text-[var(--muted)]">· {p.userId}</span>
                </span>
                <Button onClick={() => onAuthorize({ id: p.userId, name: p.userName })}>
                  <Check size={14} /> Authorize
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-[var(--muted)] mb-2">Authorized ({allowed.length})</div>
      <div className="space-y-1 mb-3">
        {allowed.length === 0 && <div className="text-xs text-[var(--muted)]">Nobody yet — authorize a pending user, or add one below.</div>}
        {allowed.map((u) => (
          <div key={u.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              {u.name || `User ${u.id}`} <span className="text-xs text-[var(--muted)]">· {u.id}</span>
            </span>
            <button onClick={() => onChange(allowed.filter((x) => x.id !== u.id))} className="text-[var(--muted)] hover:text-red-500" title="Revoke">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(id);
          if (Number.isFinite(n) && n !== 0 && !has(n)) {
            onChange([...allowed, { id: n, name: name.trim() || undefined }]);
            setId("");
            setName("");
          }
        }}
      >
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Add by Telegram user ID"
          inputMode="numeric"
          className="w-44 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-1.5 text-sm"
        />
        <Button type="submit" disabled={!id.trim()}>
          <UserPlus size={15} /> Add
        </Button>
      </form>
    </Card>
  );
}

function ChatHistory({ threads }: { threads: TgThread[] }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<number | null>(null);
  const list = threads;
  const active = list.find((t) => t.userId === userId) ?? list[0];

  const clear = useMutation({
    mutationFn: (uid: number) => apiSend("DELETE", `/api/telegram/messages?userId=${uid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telegram-messages"] }),
  });

  return (
    <Card>
      <div className="font-medium flex items-center gap-2 mb-3">
        <MessageSquare size={16} /> Chat history
        {active && (
          <button
            onClick={() => { if (confirm(`Clear chat history with ${active.userName}?`)) clear.mutate(active.userId); }}
            className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-red-500"
            title="Clear this conversation"
          >
            <Trash2 size={13} /> Clear chat
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No messages yet. They appear here once people message the bot.</p>
      ) : (
        <>
          <div className="flex gap-1 border-b border-[var(--border)] mb-3 overflow-x-auto">
            {list.map((th) => (
              <button
                key={th.userId}
                onClick={() => setUserId(th.userId)}
                className={`px-3 py-1.5 text-sm whitespace-nowrap border-b-2 -mb-px ${
                  active?.userId === th.userId ? "border-blue-500 text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {th.userName}
              </button>
            ))}
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {active?.messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${
                    m.direction === "out" ? "bg-blue-600 text-white rounded-br-sm" : "bg-[var(--panel-muted)] rounded-bl-sm"
                  }`}
                >
                  {m.text}
                  <div className={`text-[10px] mt-0.5 ${m.direction === "out" ? "text-blue-100" : "text-[var(--muted)]"}`}>
                    {new Date(m.at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
