import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";

export interface Schedule {
  id: string;
  name: string;
}

export interface ScheduleEntry {
  id: string;
  schedule_id: string;
  dow: number; // 0=Sun..6=Sat
  hour: number; // 0..23
  profile_id: string;
}

export class ScheduleRepo {
  constructor(private readonly db: DB) {}

  list(): Schedule[] {
    return this.db.prepare("SELECT * FROM schedules ORDER BY name").all() as Schedule[];
  }

  get(id: string): Schedule | undefined {
    return this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Schedule | undefined;
  }

  create(name: string): Schedule {
    const id = randomUUID().slice(0, 8);
    this.db.prepare("INSERT INTO schedules (id, name) VALUES (?, ?)").run(id, name);
    return this.get(id)!;
  }

  rename(id: string, name: string): void {
    this.db.prepare("UPDATE schedules SET name = ? WHERE id = ?").run(name, id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM schedule_entries WHERE schedule_id = ?").run(id);
  }

  entries(scheduleId: string): ScheduleEntry[] {
    return this.db
      .prepare("SELECT * FROM schedule_entries WHERE schedule_id = ?")
      .all(scheduleId) as ScheduleEntry[];
  }

  /** Set (or clear, when profileId is null) the profile for one weekly hour cell. */
  setCell(scheduleId: string, dow: number, hour: number, profileId: string | null): void {
    if (profileId) {
      this.db
        .prepare(
          `INSERT INTO schedule_entries (id, schedule_id, dow, hour, profile_id) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(schedule_id, dow, hour) DO UPDATE SET profile_id = excluded.profile_id`,
        )
        .run(randomUUID().slice(0, 8), scheduleId, dow, hour, profileId);
    } else {
      this.db
        .prepare("DELETE FROM schedule_entries WHERE schedule_id = ? AND dow = ? AND hour = ?")
        .run(scheduleId, dow, hour);
    }
  }

  /** Resolve the profile active at a given weekday/hour, if any. */
  profileAt(scheduleId: string, dow: number, hour: number): string | null {
    const row = this.db
      .prepare("SELECT profile_id FROM schedule_entries WHERE schedule_id = ? AND dow = ? AND hour = ?")
      .get(scheduleId, dow, hour) as { profile_id: string } | undefined;
    return row?.profile_id ?? null;
  }
}
