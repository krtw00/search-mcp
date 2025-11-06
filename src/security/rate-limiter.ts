/**
 * Rate Limiter - Token bucket-based rate limiting
 */

export interface RateLimitConfig {
  maxTokens: number;      // Maximum number of tokens in bucket
  refillRate: number;     // Tokens added per second
  windowMs?: number;      // Optional window for burst control
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.buckets = new Map();
    this.startCleanup();
  }

  /**
   * Check if a request is allowed under rate limits
   */
  checkLimit(
    identifier: string,
    config: RateLimitConfig,
    cost: number = 1
  ): RateLimitResult {
    let bucket = this.buckets.get(identifier);

    // Create bucket if it doesn't exist
    if (!bucket) {
      bucket = {
        tokens: config.maxTokens,
        lastRefill: Date.now(),
        maxTokens: config.maxTokens,
        refillRate: config.refillRate,
      };
      this.buckets.set(identifier, bucket);
    }

    // Refill tokens based on time elapsed
    this.refillBucket(bucket);

    // Check if enough tokens available
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAt: this.calculateResetTime(bucket),
      };
    }

    // Not enough tokens - rate limited
    const tokensNeeded = cost - bucket.tokens;
    const retryAfterMs = (tokensNeeded / bucket.refillRate) * 1000;

    return {
      allowed: false,
      remaining: 0,
      resetAt: this.calculateResetTime(bucket),
      retryAfter: Math.ceil(retryAfterMs / 1000), // seconds
    };
  }

  /**
   * Refill tokens in a bucket based on elapsed time
   */
  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsedMs = now - bucket.lastRefill;
    const elapsedSeconds = elapsedMs / 1000;

    // Calculate tokens to add
    const tokensToAdd = elapsedSeconds * bucket.refillRate;

    // Add tokens up to max
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Calculate when the bucket will be fully refilled
   */
  private calculateResetTime(bucket: TokenBucket): number {
    const tokensToFill = bucket.maxTokens - bucket.tokens;
    const secondsToFill = tokensToFill / bucket.refillRate;
    return Date.now() + secondsToFill * 1000;
  }

  /**
   * Get remaining tokens for an identifier
   */
  getRemainingTokens(identifier: string): number {
    const bucket = this.buckets.get(identifier);
    if (!bucket) {
      return 0;
    }

    this.refillBucket(bucket);
    return Math.floor(bucket.tokens);
  }

  /**
   * Reset rate limits for an identifier
   */
  reset(identifier: string): void {
    this.buckets.delete(identifier);
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * Get statistics for all rate limiters
   */
  getStats(): {
    totalIdentifiers: number;
    identifiers: {
      identifier: string;
      remaining: number;
      maxTokens: number;
      refillRate: number;
    }[];
  } {
    const identifiers = Array.from(this.buckets.entries()).map(([identifier, bucket]) => {
      this.refillBucket(bucket);
      return {
        identifier,
        remaining: Math.floor(bucket.tokens),
        maxTokens: bucket.maxTokens,
        refillRate: bucket.refillRate,
      };
    });

    return {
      totalIdentifiers: this.buckets.size,
      identifiers,
    };
  }

  /**
   * Start automatic cleanup of inactive buckets
   */
  private startCleanup(): void {
    // Clean up buckets older than 1 hour every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 600000); // 10 minutes
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
   * Clean up old buckets
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    const keysToDelete: string[] = [];

    for (const [identifier, bucket] of this.buckets.entries()) {
      // If bucket hasn't been accessed in over an hour and is full, remove it
      if (
        now - bucket.lastRefill > maxAge &&
        bucket.tokens >= bucket.maxTokens
      ) {
        keysToDelete.push(identifier);
      }
    }

    for (const key of keysToDelete) {
      this.buckets.delete(key);
    }

    if (keysToDelete.length > 0) {
      console.error(`Rate limiter cleanup: removed ${keysToDelete.length} inactive buckets`);
    }
  }
}

/**
 * Multi-tier rate limiter with different limits for different tiers
 */
export class TieredRateLimiter {
  private limiter: RateLimiter;
  private tierConfigs: Map<string, RateLimitConfig>;

  constructor() {
    this.limiter = new RateLimiter();
    this.tierConfigs = new Map();
  }

  /**
   * Set rate limit config for a tier
   */
  setTierConfig(tier: string, config: RateLimitConfig): void {
    this.tierConfigs.set(tier, config);
  }

  /**
   * Check rate limit for a specific tier
   */
  checkLimit(
    identifier: string,
    tier: string,
    cost: number = 1
  ): RateLimitResult {
    const config = this.tierConfigs.get(tier);

    if (!config) {
      throw new Error(`Rate limit tier not configured: ${tier}`);
    }

    const bucketKey = `${tier}:${identifier}`;
    return this.limiter.checkLimit(bucketKey, config, cost);
  }

  /**
   * Get remaining tokens for an identifier in a tier
   */
  getRemainingTokens(identifier: string, tier: string): number {
    const bucketKey = `${tier}:${identifier}`;
    return this.limiter.getRemainingTokens(bucketKey);
  }

  /**
   * Reset limits for an identifier in a tier
   */
  reset(identifier: string, tier?: string): void {
    if (tier) {
      const bucketKey = `${tier}:${identifier}`;
      this.limiter.reset(bucketKey);
    } else {
      // Reset all tiers for this identifier
      for (const tierName of this.tierConfigs.keys()) {
        const bucketKey = `${tierName}:${identifier}`;
        this.limiter.reset(bucketKey);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return this.limiter.getStats();
  }

  /**
   * Stop cleanup
   */
  stop(): void {
    this.limiter.stopCleanup();
  }
}

// Global singleton instance
let globalRateLimiter: TieredRateLimiter | null = null;

/**
 * Get the global rate limiter instance
 */
export function getRateLimiter(): TieredRateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new TieredRateLimiter();

    // Set default tiers
    globalRateLimiter.setTierConfig('default', {
      maxTokens: 100,
      refillRate: 10, // 10 requests per second
    });

    globalRateLimiter.setTierConfig('authenticated', {
      maxTokens: 1000,
      refillRate: 50, // 50 requests per second
    });

    globalRateLimiter.setTierConfig('premium', {
      maxTokens: 5000,
      refillRate: 200, // 200 requests per second
    });
  }

  return globalRateLimiter;
}

/**
 * Initialize the global rate limiter with custom tiers
 */
export function initializeRateLimiter(
  tiers: Map<string, RateLimitConfig>
): TieredRateLimiter {
  const limiter = new TieredRateLimiter();

  for (const [tier, config] of tiers) {
    limiter.setTierConfig(tier, config);
  }

  globalRateLimiter = limiter;
  return limiter;
}
