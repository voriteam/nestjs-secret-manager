interface CacheEntry {
  value: string;
  cachedAt: number;
}

/**
 * In-memory cache for secrets.
 * Uses a composite key of backend:name:version for cache entries.
 */
export class SecretCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs?: number) {}

  /**
   * Generate a cache key from backend, name, and version.
   */
  private getCacheKey(backend: string, name: string, version?: string): string {
    return `${backend}:${name}:${version ?? 'latest'}`;
  }

  /**
   * Get a cached secret value.
   *
   * @param backend - Backend name
   * @param name - Secret name
   * @param version - Secret version (defaults to 'latest')
   * @returns The cached value, or undefined if not found or expired
   */
  get(backend: string, name: string, version?: string): string | undefined {
    const key = this.getCacheKey(backend, name, version);
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check TTL if configured
    if (this.ttlMs !== undefined && Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a cached secret value.
   *
   * @param backend - Backend name
   * @param name - Secret name
   * @param value - Secret value
   * @param version - Secret version (defaults to 'latest')
   */
  set(backend: string, name: string, value: string, version?: string): void {
    const key = this.getCacheKey(backend, name, version);
    this.cache.set(key, {
      value,
      cachedAt: Date.now(),
    });
  }

  /**
   * Check if a secret is cached.
   *
   * @param backend - Backend name
   * @param name - Secret name
   * @param version - Secret version (defaults to 'latest')
   * @returns True if the secret is cached and not expired
   */
  has(backend: string, name: string, version?: string): boolean {
    return this.get(backend, name, version) !== undefined;
  }

  /**
   * Delete a specific cached secret.
   *
   * @param backend - Backend name
   * @param name - Secret name
   * @param version - Secret version (defaults to 'latest')
   * @returns True if the entry was deleted
   */
  delete(backend: string, name: string, version?: string): boolean {
    const key = this.getCacheKey(backend, name, version);
    return this.cache.delete(key);
  }

  /**
   * Clear all cached secrets.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }
}
