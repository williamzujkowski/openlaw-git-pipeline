import { MAX_RETRIES, BASE_BACKOFF_MS } from './constants.js';
import type { Logger } from './logger.js';

/** Result type mirroring @civic-source/types to avoid circular dependency */
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchWithRetryOptions extends RequestInit {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Fetch with exponential backoff retry.
 * Retries up to `maxRetries` times on network/server errors.
 */
export async function fetchWithRetry(
  url: string,
  options?: FetchWithRetryOptions & { logger?: Logger }
): Promise<Result<Response, Error>> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? BASE_BACKOFF_MS;
  const logger = options?.logger;

  // Strip custom options before passing to fetch
  const fetchOptions: RequestInit = { ...options };
  delete (fetchOptions as Record<string, unknown>)['maxRetries'];
  delete (fetchOptions as Record<string, unknown>)['baseDelayMs'];
  delete (fetchOptions as Record<string, unknown>)['logger'];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok) return ok(response);

      if (response.status >= 500 && attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        logger?.warn('Server error, retrying', { url, status: response.status, attempt, delayMs });
        await sleep(delayMs);
        continue;
      }
      return err(new Error(`HTTP ${response.status}: ${response.statusText}`));
    } catch (error: unknown) {
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        logger?.warn('Network error, retrying', { url, attempt, delayMs });
        await sleep(delayMs);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Network error after ${maxRetries} attempts: ${message}`));
    }
  }
  return err(new Error(`Failed after ${maxRetries} attempts`));
}
