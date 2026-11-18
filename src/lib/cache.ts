/**
 * Tiny in-memory TTL cache for API responses. It stores promises, so
 * concurrent identical requests share one network call, and rejected
 * promises are evicted immediately so errors are never cached. Oldest entries
 * are evicted first once `maxEntries` is reached.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { expires: number; value: Promise<V> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 256,
    private readonly clock: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0 && this.maxEntries > 0;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getOrCreate(key: string, create: () => Promise<V>, ttlMs = this.ttlMs): Promise<V> {
    if (!this.enabled || ttlMs <= 0) return create();
    const now = this.clock();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return hit.value;
    if (hit) this.entries.delete(key);

    const value = create();
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { expires: now + ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
}
