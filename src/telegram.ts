// Telegram bot: long-polls getUpdates, downloads photos sent to the bot, and uploads
// them into Immich (optionally adding them to a target album). Started/stopped from the
// telegram config in app_settings.
import type { ImmichClient } from "./immich.js";
import type { AppSettingsRepo } from "./repositories/appSettings.js";

export interface AllowedUser {
  id: number;
  name?: string;
}

interface TelegramConfig {
  enabled: boolean;
  targetAlbumId: string | null;
  botToken: string;
  allowedUsers?: AllowedUser[];
}

interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
}
interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
}

export type MessageLogger = (userId: number, userName: string, direction: "in" | "out", text: string) => void;
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export interface BotInfo {
  id: number;
  name: string;
  username?: string;
  canJoinGroups?: boolean;
  canReadAllGroupMessages?: boolean;
  supportsInline?: boolean;
}

export interface RecentSender {
  id: number;
  name: string;
  at: number;
}

export interface TelegramStatus {
  running: boolean;
  username?: string;
  info?: BotInfo;
  received: number;
  lastAt?: number;
  lastError?: string;
  recentSenders: RecentSender[];
}

class Bot {
  private offset = 0;
  private abort = new AbortController();
  private stopped = false;
  active = false;
  username?: string;
  info?: BotInfo;
  received = 0;
  lastAt?: number;
  lastError?: string;

  recent = new Map<number, RecentSender>();
  // Per-user batching of upload confirmations, so an album/burst gets one summary reply.
  private summaries = new Map<
    number,
    { from: NonNullable<TgMessage["from"]>; chatId: number; name: string; saved: number; dup: number; failed: number; timer?: ReturnType<typeof setTimeout> }
  >();
  private readonly batchMs = 2500;

  constructor(
    private readonly token: string,
    private readonly immich: ImmichClient,
    private readonly targetAlbum: () => string | null,
    private readonly allowed: () => AllowedUser[],
    private readonly log?: MessageLogger,
  ) {}

  private isAllowed(userId: number): boolean {
    return this.allowed().some((u) => u.id === userId);
  }

  /** Send a message to a user on demand (e.g. the authorization confirmation). */
  async notify(userId: number, name: string, text: string): Promise<void> {
    await this.reply(userId, text);
    this.log?.(userId, name, "out", text);
  }

  recentSenders(): RecentSender[] {
    return [...this.recent.values()].sort((a, b) => b.at - a.at).slice(0, 10);
  }

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  /** Validate the token (always) and, if poll=true, begin receiving messages. */
  async start(poll: boolean): Promise<void> {
    try {
      const me = (await (await fetch(this.api("getMe"))).json()) as {
        ok: boolean;
        description?: string;
        result?: {
          id: number;
          first_name: string;
          username?: string;
          can_join_groups?: boolean;
          can_read_all_group_messages?: boolean;
          supports_inline_queries?: boolean;
        };
      };
      if (!me.ok || !me.result) {
        this.lastError = `Telegram rejected the token: ${me.description ?? "unauthorized"}`;
        return;
      }
      const r = me.result;
      this.username = r.username;
      this.info = {
        id: r.id,
        name: r.first_name,
        username: r.username,
        canJoinGroups: r.can_join_groups,
        canReadAllGroupMessages: r.can_read_all_group_messages,
        supportsInline: r.supports_inline_queries,
      };
      this.lastError = undefined;
      console.log(`[telegram] bot @${this.username} (id ${r.id}) validated${poll ? ", polling" : " (disabled)"}`);
      if (poll) void this.loop();
    } catch (err) {
      this.lastError = (err as Error).message;
    }
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    for (const s of this.summaries.values()) if (s.timer) clearTimeout(s.timer);
    this.summaries.clear();
  }

  private async loop(): Promise<void> {
    this.active = true;
    while (!this.stopped) {
      try {
        const url = `${this.api("getUpdates")}?offset=${this.offset}&timeout=30&allowed_updates=${encodeURIComponent('["message"]')}`;
        const res = await fetch(url, { signal: this.abort.signal });
        const body = (await res.json()) as { ok: boolean; result: TgUpdate[] };
        if (!body.ok) {
          this.lastError = "getUpdates failed";
          await sleep(5000);
          continue;
        }
        for (const u of body.result) {
          this.offset = u.update_id + 1;
          if (u.message) await this.handle(u.message).catch((e) => (this.lastError = (e as Error).message));
        }
      } catch (err) {
        if (this.stopped) break;
        this.lastError = (err as Error).message;
        await sleep(5000);
      }
    }
    this.active = false;
    console.log("[telegram] bot stopped");
  }

  private async handle(msg: TgMessage): Promise<void> {
    const from = msg.from;
    const name = from
      ? [from.first_name, from.username ? `@${from.username}` : ""].filter(Boolean).join(" ").trim() || String(from.id)
      : "unknown";

    // Track sender (for the allowlist quick-add) and log the inbound message.
    if (from) {
      this.recent.set(from.id, { id: from.id, name, at: Date.now() });
      this.log?.(from.id, name, "in", inboundText(msg));
    }

    if (from && !this.isAllowed(from.id)) {
      await this.say(
        msg.chat.id,
        from,
        name,
        `⏳ Thanks${from.first_name ? " " + from.first_name : ""}! Your request to connect is pending approval. You'll get a message once you're authorized.`,
      );
      return;
    }

    let fileId: string | undefined;
    let filename = `telegram_${msg.message_id}.jpg`;
    let mime = "image/jpeg";

    if (msg.photo && msg.photo.length) {
      fileId = msg.photo[msg.photo.length - 1].file_id; // largest size
    } else if (msg.document && (msg.document.mime_type ?? "").startsWith("image/")) {
      fileId = msg.document.file_id;
      filename = msg.document.file_name ?? filename;
      mime = msg.document.mime_type ?? mime;
    }
    if (!fileId) return; // not an image
    if (!from) return; // images without a sender can't be batched/confirmed

    try {
      const buffer = await this.download(fileId);
      const created = new Date(msg.date * 1000).toISOString();
      const { id, status } = await this.immich.uploadAsset(buffer, filename, mime, created);
      const albumId = this.targetAlbum();
      if (albumId && status !== "duplicate") {
        await this.immich.addToAlbum(albumId, [id]).catch(() => undefined);
      }
      this.received += 1;
      this.lastAt = Date.now();
      this.queueUploadReply(from, msg.chat.id, name, status === "duplicate" ? "dup" : "saved");
    } catch (err) {
      this.lastError = (err as Error).message;
      this.queueUploadReply(from, msg.chat.id, name, "failed");
    }
  }

  /** Send a reply and log it as an outbound message under the user's thread. */
  private async say(chatId: number, from: TgMessage["from"], name: string, text: string): Promise<void> {
    await this.reply(chatId, text);
    if (from) this.log?.(from.id, name, "out", text);
  }

  /** Record an upload outcome and (re)arm a debounce timer to send one consolidated reply. */
  private queueUploadReply(
    from: NonNullable<TgMessage["from"]>,
    chatId: number,
    name: string,
    outcome: "saved" | "dup" | "failed",
  ): void {
    let s = this.summaries.get(from.id);
    if (!s) {
      s = { from, chatId, name, saved: 0, dup: 0, failed: 0 };
      this.summaries.set(from.id, s);
    }
    s.saved += outcome === "saved" ? 1 : 0;
    s.dup += outcome === "dup" ? 1 : 0;
    s.failed += outcome === "failed" ? 1 : 0;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => void this.flushSummary(from.id), this.batchMs);
    s.timer.unref?.();
  }

  private async flushSummary(userId: number): Promise<void> {
    const s = this.summaries.get(userId);
    if (!s) return;
    this.summaries.delete(userId);
    const total = s.saved + s.dup + s.failed;
    let text: string;
    if (total === 1) {
      text = s.saved ? "✅ Saved to Immich" : s.dup ? "↔️ Already in your library" : "⚠️ Upload failed";
    } else {
      const parts: string[] = [];
      if (s.saved) parts.push(`✅ Saved ${s.saved} photos to Immich`);
      if (s.dup) parts.push(`↔️ ${s.dup} already in your library`);
      if (s.failed) parts.push(`⚠️ ${s.failed} failed`);
      text = parts.join("\n");
    }
    await this.say(s.chatId, s.from, s.name, text);
  }

  private async download(fileId: string): Promise<Buffer> {
    const gf = (await (await fetch(`${this.api("getFile")}?file_id=${fileId}`)).json()) as {
      ok: boolean;
      result?: { file_path: string };
    };
    if (!gf.ok || !gf.result) throw new Error("getFile failed");
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${gf.result.file_path}`);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async reply(chatId: number, text: string): Promise<void> {
    await fetch(`${this.api("sendMessage")}?chat_id=${chatId}&text=${encodeURIComponent(text)}`).catch(() => undefined);
  }
}

/** Owns the running bot; reconfigures it when the telegram settings change. */
export class TelegramManager {
  private bot?: Bot;
  private token = "";
  private enabled = false;
  private targetAlbumId: string | null = null;
  private allowed: AllowedUser[] = [];

  constructor(
    private readonly immich: ImmichClient,
    private readonly appSettings: AppSettingsRepo,
    private readonly log?: MessageLogger,
  ) {}

  apply(): void {
    const cfg = this.appSettings.get<TelegramConfig>("telegram", { enabled: false, targetAlbumId: null, botToken: "" });
    const restart = cfg.botToken !== this.token || cfg.enabled !== this.enabled || !this.bot;
    // Update live config first so the running bot picks up allowlist/album changes without a restart.
    this.token = cfg.botToken;
    this.enabled = cfg.enabled;
    this.targetAlbumId = cfg.targetAlbumId;
    this.allowed = cfg.allowedUsers ?? [];

    if (!cfg.botToken) {
      this.bot?.stop();
      this.bot = undefined;
      return;
    }
    if (restart) {
      this.bot?.stop();
      this.bot = new Bot(cfg.botToken, this.immich, () => this.targetAlbumId, () => this.allowed, this.log);
      void this.bot.start(cfg.enabled); // validate always; poll only when enabled
    }
  }

  async notify(userId: number, name: string, text: string): Promise<void> {
    await this.bot?.notify(userId, name, text);
  }

  status(): TelegramStatus {
    return {
      running: !!this.bot?.active,
      username: this.bot?.username,
      info: this.bot?.info,
      received: this.bot?.received ?? 0,
      lastAt: this.bot?.lastAt,
      lastError: this.bot?.lastError,
      recentSenders: this.bot?.recentSenders() ?? [],
    };
  }
}

function inboundText(msg: TgMessage): string {
  if (msg.photo?.length) return msg.caption ? `[photo] ${msg.caption}` : "[photo]";
  if (msg.document) return `[file] ${msg.document.file_name ?? ""}`.trim();
  if (msg.text) return msg.text;
  return "[message]";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
