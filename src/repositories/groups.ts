import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";

export interface Group {
  id: string;
  name: string;
  created_at: number;
}

export class GroupRepo {
  constructor(private readonly db: DB) {}

  list(): Group[] {
    return this.db.prepare("SELECT * FROM groups ORDER BY created_at").all() as Group[];
  }

  get(id: string): Group | undefined {
    return this.db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as Group | undefined;
  }

  create(name: string): Group {
    const id = randomUUID().slice(0, 8);
    this.db.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run(id, name, Date.now());
    return this.get(id)!;
  }

  rename(id: string, name: string): void {
    this.db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(name, id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM groups WHERE id = ?").run(id);
    // Detach members rather than deleting them.
    this.db.prepare("UPDATE devices SET group_id = NULL WHERE group_id = ?").run(id);
  }
}
