// Runtime, user-editable settings persisted to a small JSON file. Seeded from env
// on first run, then mutated via the admin UI (album selection) at runtime.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface Settings {
  /** Immich album ids the frame draws photos from. */
  albumIds: string[];
}

export class SettingsStore {
  private current: Settings;

  constructor(
    private readonly file: string,
    seed: Settings,
  ) {
    this.current = this.loadOrSeed(seed);
  }

  private loadOrSeed(seed: Settings): Settings {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Settings>;
      return { albumIds: parsed.albumIds ?? seed.albumIds };
    } catch {
      return { ...seed };
    }
  }

  get(): Settings {
    return this.current;
  }

  /** Merge a partial update, persist to disk, and return the new settings. */
  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch };
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.current, null, 2));
    return this.current;
  }
}
