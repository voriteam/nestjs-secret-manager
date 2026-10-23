interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

const REDACTED = '[SecretCache redacted]';

/**
 * In-memory cache for secrets.
 * Uses a composite key of backend:name:version for cache entries.
 *
 * The internal Map is held as a JS `#private` field so it cannot be reached
 * via property access on the instance, and `toJSON` / `util.inspect.custom`
 * are overridden to redact contents in case the cache (or its containing
 * service) is accidentally serialized by a logger or error reporter.
 */
export class SecretCache<T = string> {
  readonly #cache = new Map<string, CacheEntry<T>>();
  readonly #inFlight = new Map<string, Promise<T>>();
  readonly #ttlMs?: number;
  readonly #retain: boolean;

  /** @param retain - False shares in-flight loads without caching results. */
  constructor(ttlMs?: number, retain = true) {
    this.#ttlMs = ttlMs;
    this.#retain = retain;
  }

  /**
   * Generate a cache key from backend, name, and version.
   */
  private getCacheKey(backend: string, name: string, version?: string): string {
    return `${backend}:${name}:${version ?? 'latest'}`;
  }

  /**
   * Get a cached secret value.
   *
   * @returns The cached value, or undefined if not found or expired.
   */
  get(backend: string, name: string, version?: string): T | undefined {
    const key = this.getCacheKey(backend, name, version);
    const entry = this.#cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (
      this.#ttlMs !== undefined &&
      Date.now() - entry.cachedAt > this.#ttlMs
    ) {
      this.#cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a cached secret value.
   */
  set(backend: string, name: string, value: T, version?: string): void {
    const key = this.getCacheKey(backend, name, version);
    this.#cache.set(key, {
      value,
      cachedAt: Date.now(),
    });
  }

  /**
   * The cached value, or the result of `load`, which concurrent misses for one
   * secret share. A load that `delete` or `clear` overtakes is not cached.
   */
  async read(
    backend: string,
    name: string,
    version: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get(backend, name, version);
    if (cached !== undefined) {
      return cached;
    }

    const key = this.getCacheKey(backend, name, version);
    const inFlight = this.#inFlight.get(key);
    if (inFlight !== undefined) {
      return await inFlight;
    }

    const loading: Promise<T> = load()
      .then((value) => {
        if (this.#retain && this.#inFlight.get(key) === loading) {
          this.set(backend, name, value, version);
        }
        return value;
      })
      .finally(() => {
        if (this.#inFlight.get(key) === loading) {
          this.#inFlight.delete(key);
        }
      });
    this.#inFlight.set(key, loading);
    return await loading;
  }

  /**
   * Check if a secret is cached and not expired.
   */
  has(backend: string, name: string, version?: string): boolean {
    return this.get(backend, name, version) !== undefined;
  }

  /**
   * Delete a specific cached secret.
   *
   * @returns True if the entry was deleted.
   */
  delete(backend: string, name: string, version?: string): boolean {
    const key = this.getCacheKey(backend, name, version);
    this.#inFlight.delete(key);
    return this.#cache.delete(key);
  }

  /**
   * Clear all cached secrets.
   */
  clear(): void {
    this.#cache.clear();
    this.#inFlight.clear();
  }

  /**
   * Get the number of cached entries.
   */
  get size(): number {
    return this.#cache.size;
  }

  /** Redact when serialized via JSON. */
  toJSON(): string {
    return REDACTED;
  }

  /** Redact when inspected by util.inspect / console.log / pino / winston. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}
