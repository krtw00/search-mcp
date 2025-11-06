/**
 * Tool Result Cache - Caches tool execution results
 */

import { CacheManager, type CacheOptions } from './cache-manager.js';
import { getConfigManager } from '../config/config-manager.js';

export class ToolResultCache {
  private cache: CacheManager<any>;

  constructor(options?: CacheOptions) {
    const defaultOptions: CacheOptions = {
      ttl: 300000,  // 5 minutes default
      maxSize: 500,
      strategy: 'LRU',
    };

    this.cache = new CacheManager(options || defaultOptions);
  }

  /**
   * Generate a cache key from tool name and parameters
   */
  private generateKey(toolName: string, parameters: Record<string, any>): string {
    // Sort keys for consistent cache keys
    const sortedParams = Object.keys(parameters).sort();
    const paramString = JSON.stringify(
      sortedParams.reduce((acc, key) => {
        acc[key] = parameters[key];
        return acc;
      }, {} as Record<string, any>)
    );

    return `${toolName}:${paramString}`;
  }

  /**
   * Cache a tool execution result
   */
  cacheResult(
    toolName: string,
    parameters: Record<string, any>,
    result: any,
    ttl?: number
  ): void {
    const key = this.generateKey(toolName, parameters);

    // Check if caching is enabled for this tool
    const configManager = getConfigManager();
    const toolConfig = configManager.getToolConfig(toolName);

    if (!toolConfig.cache?.enabled) {
      return; // Caching disabled for this tool
    }

    const effectiveTTL = ttl || toolConfig.cache.ttl * 1000; // Convert seconds to ms
    this.cache.set(key, result, effectiveTTL);
  }

  /**
   * Get a cached tool execution result
   */
  getCachedResult(
    toolName: string,
    parameters: Record<string, any>
  ): any | undefined {
    // Check if caching is enabled for this tool
    const configManager = getConfigManager();
    const toolConfig = configManager.getToolConfig(toolName);

    if (!toolConfig.cache?.enabled) {
      return undefined; // Caching disabled for this tool
    }

    const key = this.generateKey(toolName, parameters);
    return this.cache.get(key);
  }

  /**
   * Check if a result is cached
   */
  has(toolName: string, parameters: Record<string, any>): boolean {
    const key = this.generateKey(toolName, parameters);
    return this.cache.has(key);
  }

  /**
   * Clear cache for a specific tool
   */
  clearToolCache(toolName: string): void {
    const keys = this.cache.keys();
    const prefix = `${toolName}:`;

    for (const key of keys) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached results
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Execute a tool with caching
   */
  async executeWithCache<T>(
    toolName: string,
    parameters: Record<string, any>,
    executor: () => Promise<T>,
    ttl?: number
  ): Promise<{ result: T; cached: boolean }> {
    // Check cache first
    const cached = this.getCachedResult(toolName, parameters);
    if (cached !== undefined) {
      return { result: cached, cached: true };
    }

    // Execute and cache
    const result = await executor();
    this.cacheResult(toolName, parameters, result, ttl);

    return { result, cached: false };
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    const keys = this.cache.keys();
    let count = 0;

    for (const key of keys) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size();
  }

  /**
   * Stop cache cleanup
   */
  stop(): void {
    this.cache.stopCleanup();
  }
}

// Global singleton instance
let globalToolCache: ToolResultCache | null = null;

/**
 * Get the global tool result cache instance
 */
export function getToolCache(): ToolResultCache {
  if (!globalToolCache) {
    globalToolCache = new ToolResultCache();
  }
  return globalToolCache;
}

/**
 * Initialize the global tool cache with custom options
 */
export function initializeToolCache(options: CacheOptions): ToolResultCache {
  globalToolCache = new ToolResultCache(options);
  return globalToolCache;
}
