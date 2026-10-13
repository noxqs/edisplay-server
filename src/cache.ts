// Simple on-disk cache for converted PNGs. Conversion is CPU-heavy, so we keep the
// rendered output keyed by asset + processing settings (the same key as the ETag).
import path from "node:path";
import { mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";

export class DiskCache {
  private readonly ready: Promise<unknown>;

  constructor(
    private readonly dir: string,
    private readonly maxEntries: number,
  ) {
    this.ready = mkdir(this.dir, { recursive: true });
  }

  private file(key: string): string {
    const safe = key.replace(/[^A-Za-z0-9_-]/g, "_");
    return path.join(this.dir, `${safe}.png`);
  }

  async get(key: string): Promise<Buffer | null> {
    await this.ready;
    try {
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }

  async set(key: string, buf: Buffer): Promise<void> {
    await this.ready;
    await writeFile(this.file(key), buf);
    this.prune().catch((err) => console.warn("[cache] prune failed:", err));
  }

  /** Evict the oldest files once the entry count exceeds the cap. */
  private async prune(): Promise<void> {
    if (this.maxEntries <= 0) return;
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".png"));
    if (files.length <= this.maxEntries) return;
    const withMtime = await Promise.all(
      files.map(async (f) => ({ f, m: (await stat(path.join(this.dir, f))).mtimeMs })),
    );
    withMtime.sort((a, b) => a.m - b.m);
    const remove = withMtime.slice(0, files.length - this.maxEntries);
    await Promise.all(remove.map((s) => rm(path.join(this.dir, s.f), { force: true })));
  }
}
