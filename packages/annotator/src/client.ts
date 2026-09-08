import { type Result, ok, err } from '@civic-source/types';
import { type Logger, MAX_RETRIES, BASE_BACKOFF_MS, TokenBucket } from '@civic-source/shared';
import {
  COURTLISTENER_BASE_URL,
  SEARCH_ENDPOINT,
  COURTLISTENER_RATE_LIMITER,
  DEFAULT_PAGE_SIZE,
  MAX_API_RESPONSE_BYTES,
} from './constants.js';

/**
 * Read a response body as JSON without letting an unbounded body reach memory
 * (#223 item 3).
 *
 * Two layers, because either alone is insufficient:
 *
 *  1. `Content-Length`, when present and over the cap, rejects before a single
 *     byte of body is read. This is the cheap path and handles the honest case.
 *  2. A streaming read that aborts the moment the running total exceeds the cap.
 *     Necessary because Content-Length is absent on a chunked response and is
 *     attacker-controlled on a redirected one — a server that lies about it
 *     would walk straight past layer 1. Buffering via `arrayBuffer()` and then
 *     checking the length would defeat the purpose: the OOM happens during the
 *     read, not after it.
 *
 * Mirrors the fetcher's `exceedsContentLengthLimit` + `readBytesCapped` pair.
 * The logic is duplicated rather than shared because `@civic-source/annotator`
 * does not depend on `@civic-source/fetcher`; hoisting both into
 * `@civic-source/shared` would be the DRY fix and is left as a follow-up rather
 * than bundled into a security change.
 */
export async function readJsonCapped(response: Response): Promise<Result<unknown>> {
  // Optional-chained because this must not assume more of the object than it
  // needs: a real Response always carries `headers` and `body`, but test doubles
  // and polyfilled fetches routinely supply only `.json()`. Throwing on those
  // would turn a size guard into an availability bug, and the retry loop would
  // swallow the TypeError as a transient failure.
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_API_RESPONSE_BYTES) {
    return err(
      new Error(
        `Response body declares ${String(declared)} bytes, over the ${String(MAX_API_RESPONSE_BYTES)}-byte cap`
      )
    );
  }

  const body = response.body;
  if (body === null || body === undefined) {
    // No readable stream to bound — an empty body, or a Response-like without
    // one. Nothing can grow during the read, so defer to the object's own
    // parse; the cap has no work to do here.
    try {
      return ok((await response.json()) as unknown);
    } catch (error: unknown) {
      return err(
        new Error(
          `Malformed JSON response: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_API_RESPONSE_BYTES) {
        await reader.cancel();
        return err(
          new Error(`Response body exceeded the ${String(MAX_API_RESPONSE_BYTES)}-byte cap`)
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return parseJsonResult(Buffer.concat(chunks).toString('utf-8'));
}

/** Parse JSON into a Result rather than throwing past the retry loop. */
function parseJsonResult(text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (error: unknown) {
    return err(new Error(`Malformed JSON response: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/** Raw result shape from the CourtListener search API */
export interface CourtListenerResult {
  caseName: string;
  citation: string[];
  court: string;
  dateFiled: string;
  snippet: string;
  absolute_url: string;
}

/**
 * Validate that an unknown value is a well-formed CourtListener result.
 *
 * The search API is untrusted: a result object missing or mistyping a field
 * (e.g. no `snippet`, a non-array `citation`, a numeric `court`) would later
 * make `annotateSection` throw on `result.citation[0]` / `mapCourt(...)` /
 * truncation, escaping its `Result<>` contract as a rejected promise. Checking
 * every field up front lets the client drop malformed elements instead (#237).
 */
export function isCourtListenerResult(value: unknown): value is CourtListenerResult {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o['caseName'] === 'string' &&
    Array.isArray(o['citation']) &&
    o['citation'].every((c) => typeof c === 'string') &&
    typeof o['court'] === 'string' &&
    typeof o['dateFiled'] === 'string' &&
    typeof o['snippet'] === 'string' &&
    typeof o['absolute_url'] === 'string'
  );
}

/** Validate that an unknown value has the expected search-response envelope */
function hasResultsArray(data: unknown): data is { results: unknown[] } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj['results']);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CourtListener API client with retry logic and token bucket rate limiting.
 *
 * Note: Statute citations are not indexed as structured fields in CourtListener.
 * We use full-text search (e.g., q="18 U.S.C. 111"), so coverage is approximate.
 */
export class CourtListenerClient {
  private readonly token: string;
  private readonly logger: Logger;
  private readonly pageSize: number;
  private readonly rateLimiter: TokenBucket;

  constructor(options: { token: string; logger: Logger; pageSize?: number; rateLimiter?: TokenBucket }) {
    this.token = options.token;
    this.logger = options.logger;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.rateLimiter = options.rateLimiter ?? new TokenBucket(COURTLISTENER_RATE_LIMITER);
  }

  /**
   * Search for opinions mentioning a statute section.
   * Uses full-text search since statute citations are not structured fields.
   */
  async searchByStatute(section: string): Promise<Result<CourtListenerResult[]>> {
    if (!this.rateLimiter.tryConsume()) {
      this.logger.warn('Rate limited, waiting for token', { section });
      await this.rateLimiter.waitAndConsume();
    }

    const url = new URL(SEARCH_ENDPOINT, COURTLISTENER_BASE_URL);
    url.searchParams.set('q', `"${section}"`);
    url.searchParams.set('type', 'o'); // opinions
    url.searchParams.set('order_by', 'dateFiled desc');
    url.searchParams.set('page_size', String(this.pageSize));

    this.logger.info('Searching CourtListener', { section, url: url.toString() });

    const result = await this.fetchWithRetry(url.toString());
    if (!result.ok) return result;

    const data = result.value;
    if (!hasResultsArray(data)) {
      return ok([]);
    }
    // Drop any malformed result element so callers only ever receive
    // well-formed CourtListenerResult objects (#237).
    const valid = data.results.filter(isCourtListenerResult);
    const dropped = data.results.length - valid.length;
    if (dropped > 0) {
      this.logger.warn('Dropped malformed CourtListener results', { section, dropped });
    }
    return ok(valid);
  }

  /** Fetch with exponential backoff retry, including 429 handling */
  private async fetchWithRetry(url: string): Promise<Result<unknown>> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Token ${this.token}` },
        });

        if (response.ok) {
          const parsed = await readJsonCapped(response);
          if (!parsed.ok) return parsed;
          return ok(parsed.value);
        }

        if (response.status === 401) {
          return err(new Error('Invalid API token: authentication failed'));
        }

        if (response.status === 429 && attempt < MAX_RETRIES) {
          const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
          this.logger.warn('Rate limited (429), retrying', { url, attempt, delayMs });
          await sleep(delayMs);
          continue;
        }

        if (response.status >= 500 && attempt < MAX_RETRIES) {
          const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          this.logger.warn('Server error, retrying', { url, status: response.status, attempt, delayMs });
          await sleep(delayMs);
          continue;
        }

        return err(new Error(`HTTP ${response.status}: ${response.statusText}`));
      } catch (error: unknown) {
        if (attempt < MAX_RETRIES) {
          const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          this.logger.warn('Network error, retrying', { url, attempt, delayMs });
          await sleep(delayMs);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        return err(new Error(`Network error after ${MAX_RETRIES} attempts: ${message}`));
      }
    }
    return err(new Error(`Failed after ${MAX_RETRIES} attempts`));
  }
}
