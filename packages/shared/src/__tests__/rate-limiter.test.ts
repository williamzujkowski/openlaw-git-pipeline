import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenBucket } from '../rate-limiter.js';

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with full capacity', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillIntervalMs: 1000 });
    expect(bucket.available).toBe(10);
  });

  it('consumes tokens correctly', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume(3)).toBe(true);
    expect(bucket.available).toBe(7);

    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.available).toBe(6);
  });

  it('rejects when not enough tokens', () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
    expect(bucket.available).toBe(0);
  });

  it('rejects when requesting more than available', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume(3)).toBe(true);
    expect(bucket.tryConsume(3)).toBe(false);
    expect(bucket.available).toBe(2);
  });

  it('refills tokens over time', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 2, refillIntervalMs: 1000 });

    // Drain all tokens
    expect(bucket.tryConsume(10)).toBe(true);
    expect(bucket.available).toBe(0);

    // Advance 1 interval: +2 tokens
    vi.advanceTimersByTime(1000);
    expect(bucket.available).toBe(2);

    // Advance 2 more intervals: +4 tokens
    vi.advanceTimersByTime(2000);
    expect(bucket.available).toBe(6);
  });

  it('does not exceed capacity on refill', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 3, refillIntervalMs: 1000 });

    // Consume 1 token (4 remaining)
    bucket.tryConsume(1);

    // Advance enough time to overfill
    vi.advanceTimersByTime(5000);
    expect(bucket.available).toBe(5); // capped at capacity
  });

  it('waitAndConsume resolves immediately when tokens available', async () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, refillIntervalMs: 1000 });

    await bucket.waitAndConsume(3);
    expect(bucket.available).toBe(7);
  });

  it('waitAndConsume waits for refill when tokens insufficient', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, refillIntervalMs: 1000 });

    // Drain the bucket
    bucket.tryConsume(2);
    expect(bucket.available).toBe(0);

    // Start waiting for 1 token
    const consumePromise = bucket.waitAndConsume(1);

    // Advance time to allow refill
    vi.advanceTimersByTime(1000);

    await consumePromise;

    // The token was consumed after waiting
    expect(bucket.available).toBe(0);
  });

  it('defaults count to 1 for tryConsume', () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 1, refillIntervalMs: 1000 });

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.available).toBe(2);
  });
});
