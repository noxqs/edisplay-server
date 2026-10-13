import type { DB } from "../db.js";

export interface TelegramMessage {
  id: number;
  user_id: number;
  user_name: string;
  direction: "in" | "out";
  text: string;
  at: number;
}

export interface TelegramThread {
  userId: number;
  userName: string;
  lastAt: number;
  messages: TelegramMessage[];
}

export class TelegramMessageRepo {
  constructor(private readonly db: DB) {}

  log(userId: number, userName: string, direction: "in" | "out", text: string): void {
    this.db
      .prepare("INSERT INTO telegram_messages (user_id, user_name, direction, text, at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, userName, direction, text, Date.now());
  }

  /** Delete chat history — a single user's thread, or all when userId is omitted. */
  clear(userId?: number): void {
    if (userId === undefined) this.db.prepare("DELETE FROM telegram_messages").run();
    else this.db.prepare("DELETE FROM telegram_messages WHERE user_id = ?").run(userId);
  }

  /** All messages grouped into per-user threads (newest activity first). */
  threads(perUserLimit = 100): TelegramThread[] {
    const rows = this.db
      .prepare("SELECT * FROM telegram_messages ORDER BY at ASC")
      .all() as TelegramMessage[];
    const byUser = new Map<number, TelegramThread>();
    for (const m of rows) {
      let t = byUser.get(m.user_id);
      if (!t) {
        t = { userId: m.user_id, userName: m.user_name, lastAt: m.at, messages: [] };
        byUser.set(m.user_id, t);
      }
      t.userName = m.user_name; // keep latest known name
      t.lastAt = m.at;
      t.messages.push(m);
    }
    const threads = [...byUser.values()];
    for (const t of threads) t.messages = t.messages.slice(-perUserLimit);
    return threads.sort((a, b) => b.lastAt - a.lastAt);
  }
}
