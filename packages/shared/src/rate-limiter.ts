/** Configuration for the token bucket rate limiter */
export interface TokenBucketConfig {
  /** Maximum number of tokens the bucket can hold */
  capacity: number;
  /** Number of tokens added per refill interval */
  refillRate: number;
  /** Time between refills in milliseconds */
  refillIntervalMs: number;
}

/**
 * Token bucket rate limiter.
 *
 * Tokens are consumed on each request and refilled at a fixed rate.
 * When the bucket is empty, requests are either rejected (tryConsume)
 * or queued until tokens become available (waitAndConsume).
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly refillIntervalMs: number;
  private lastRefillTime: number;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.refillIntervalMs = config.refillIntervalMs;
    this.tokens = config.capacity;
    this.lastRefillTime = Date.now();
  }

  /** Refill tokens based on elapsed time since last refill */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const intervals = Math.floor(elapsed / this.refillIntervalMs);

    if (intervals > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + intervals * this.refillRate);
      this.lastRefillTime += intervals * this.refillIntervalMs;
    }
  }

  /** Returns true if tokens were consumed, false if rate limited */
  tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** Wait until enough tokens are available, then consume them */
  async waitAndConsume(count = 1): Promise<void> {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    const deficit = count - this.tokens;
    const intervalsNeeded = Math.ceil(deficit / this.refillRate);
    const waitMs = intervalsNeeded * this.refillIntervalMs;

    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

    this.refill();
    this.tokens -= count;
  }

  /** Current number of available tokens */
  get available(): number {
    this.refill();
    return this.tokens;
  }
}
