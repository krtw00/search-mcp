/**
 * Cache Manager - In-memory caching with multiple eviction strategies
 */

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  hits: number;
  lastAccessedAt: number;
}

export interface CacheOptions {
  ttl: number;           // Time to live in milliseconds
  maxSize?: number;      // Maximum number of entries
  strategy?: 'LRU' | 'LFU' | 'FIFO';
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  oldestEntry?: number;
  newestEntry?: number;
}

export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>>;
  private options: Required<CacheOptions>;
  private stats: { hits: number; misses: number };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: CacheOptions) {
    this.cache = new Map();
    this.options = {
      ttl: options.ttl,
      maxSize: options.maxSize || 1000,
      strategy: options.strategy || 'LRU',
    };
    this.stats = { hits: 0, misses: 0 };

    // Start automatic cleanup
    this.startCleanup();
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttl || this.options.ttl);

    // Check if we need to evict
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      this.evict();
    }

    this.cache.set(key, {
      value,
      createdAt: now,
      expiresAt,
      hits: 0,
      lastAccessedAt: now,
    });
  }

  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if expired
    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Update access statistics
    entry.hits++;
    entry.lastAccessedAt = now;
    this.stats.hits++;

    return entry.value;
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const totalRequests = this.stats.hits + this.stats.misses;

    let oldestEntry: number | undefined;
    let newestEntry: number | undefined;

    if (entries.length > 0) {
      oldestEntry = Math.min(...entries.map(e => e.createdAt));
      newestEntry = Math.max(...entries.map(e => e.createdAt));
    }

    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Get all keys in the cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the size of the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Start automatic cleanup of expired entries
   */
  private startCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    if (keysToDelete.length > 0) {
      console.error(`Cache cleanup: removed ${keysToDelete.length} expired entries`);
    }
  }

  /**
   * Evict an entry based on the configured strategy
   */
  private evict(): void {
    if (this.cache.size === 0) {
      return;
    }

    let keyToEvict: string | undefined;

    switch (this.options.strategy) {
      case 'LRU': // Least Recently Used
        keyToEvict = this.findLRUKey();
        break;
      case 'LFU': // Least Frequently Used
        keyToEvict = this.findLFUKey();
        break;
      case 'FIFO': // First In First Out
        keyToEvict = this.cache.keys().next().value;
        break;
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
    }
  }

  /**
   * Find the least recently used key
   */
  private findLRUKey(): string | undefined {
    let lruKey: string | undefined;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        lruKey = key;
      }
    }

    return lruKey;
  }

  /**
   * Find the least frequently used key
   */
  private findLFUKey(): string | undefined {
    let lfuKey: string | undefined;
    let leastHits = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < leastHits) {
        leastHits = entry.hits;
        lfuKey = key;
      }
    }

    return lfuKey;
  }

  /**
   * Get a value or compute it if not in cache
   */
  async getOrCompute(
    key: string,
    compute: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await compute();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Warm up the cache with pre-computed values
   */
  warmUp(entries: Map<string, T>, ttl?: number): void {
    for (const [key, value] of entries) {
      this.set(key, value, ttl);
    }
  }

  /**
   * Export cache contents
   */
  export(): Map<string, T> {
    const result = new Map<string, T>();
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now <= entry.expiresAt) {
        result.set(key, entry.value);
      }
    }

    return result;
  }
}
