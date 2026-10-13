// Shuffle-bag asset selection: every photo is shown once before any repeats.
// The pool is refreshed from its source on an interval so new album photos appear.

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class ShuffleBag {
  private pool: string[] = [];
  private bag: string[] = [];
  private lastRefresh = 0;

  constructor(
    private readonly refresh: () => Promise<string[]>,
    private readonly refreshMs: number,
  ) {}

  private async ensurePool(): Promise<void> {
    const stale = Date.now() - this.lastRefresh > this.refreshMs;
    if (this.pool.length === 0 || stale) {
      try {
        const ids = await this.refresh();
        if (ids.length > 0) {
          this.pool = ids;
          this.lastRefresh = Date.now();
        }
      } catch (err) {
        // Keep serving the existing pool if a refresh fails.
        if (this.pool.length === 0) throw err;
        console.warn(`[selector] pool refresh failed, reusing ${this.pool.length} ids:`, err);
      }
    }
  }

  /** Force a pool refresh on the next draw (e.g. after the album selection changes). */
  invalidate(): void {
    this.pool = [];
    this.bag = [];
    this.lastRefresh = 0;
  }

  /** Next asset id, drawing from a reshuffled bag once exhausted. */
  async next(): Promise<string> {
    await this.ensurePool();
    if (this.pool.length === 0) {
      throw new Error("No images available in the configured Immich album(s)");
    }
    if (this.bag.length === 0) {
      this.bag = shuffle([...this.pool]);
    }
    return this.bag.pop()!;
  }

  /** Snapshot of the current pool (used by /preview to pin a specific asset). */
  async poolIds(): Promise<string[]> {
    await this.ensurePool();
    return [...this.pool];
  }
}
