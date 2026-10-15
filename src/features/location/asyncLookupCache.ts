export type LookupSource = 'online' | 'cached';
export type LookupResult<T> = { value: T; source: LookupSource };

export class AsyncLookupCache<T> {
  private readonly cache = new Map<string, { value: T; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<T | null>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(ttlMs: number, now: () => number = Date.now, maxEntries = 256) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.maxEntries = Math.max(1, maxEntries);
  }

  async getOrLoad(key: string, loader: () => Promise<T | null>): Promise<LookupResult<T> | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return { value: cached.value, source: 'cached' };
    if (cached) this.cache.delete(key);

    const existing = this.pending.get(key);
    if (existing) {
      const value = await existing;
      return value === null ? null : { value, source: 'online' };
    }

    const request = loader().then((value) => {
      if (value !== null) {
        const now = this.now();
        for (const [cacheKey, entry] of this.cache) {
          if (entry.expiresAt <= now) this.cache.delete(cacheKey);
        }
        while (this.cache.size >= this.maxEntries) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey === undefined) break;
          this.cache.delete(oldestKey);
        }
        this.cache.set(key, { value, expiresAt: now + this.ttlMs });
      }
      return value;
    });
    this.pending.set(key, request);
    try {
      const value = await request;
      return value === null ? null : { value, source: 'online' };
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.pending.clear();
  }
}
