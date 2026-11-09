/**
 * Tiny in-memory TTL cache with two production-minded behaviours:
 *
 * 1. Request coalescing: if 50 users hit the API while the cache is cold,
 *    only ONE upstream request is made; everyone awaits the same promise.
 * 2. Stale-if-error: if a refresh fails (NASA down, network blip) and we still
 *    have an older value, we serve it flagged as `stale` instead of an error.
 *
 * Why not Redis? A single instance on a free tier doesn't need it, and this
 * keeps the project dependency-free. The interface is small enough to swap
 * for Redis later without touching callers.
 */
export interface CacheResult<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
  error?: string;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<CacheResult<T>>>();

  /**
   * @param maxEntries Upper bound on stored keys; the least recently written
   *   key is evicted first. Expired entries are NOT dropped on their own,
   *   because stale-if-error needs them, so caches with many distinct keys
   *   (like the AI cache, keyed by a hash of the facts) must set a bound.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = Infinity,
  ) {}

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.fetchedAt < this.ttlMs) {
      return { ...entry, stale: false };
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.load(key, loader, entry).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async load(key: string, loader: () => Promise<T>, previous?: Entry<T>): Promise<CacheResult<T>> {
    try {
      const value = await loader();
      const fresh = { value, fetchedAt: this.now() };
      // Delete first so the key moves to the end of the Map's insertion order.
      this.entries.delete(key);
      this.entries.set(key, fresh);
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value as string;
        this.entries.delete(oldest);
      }
      return { ...fresh, stale: false };
    } catch (err) {
      if (previous) {
        return { ...previous, stale: true, error: err instanceof Error ? err.message : String(err) };
      }
      throw err;
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
