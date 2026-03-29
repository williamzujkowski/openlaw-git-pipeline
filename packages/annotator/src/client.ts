import { type Result, ok, err } from '@civic-source/types';
import { type Logger, MAX_RETRIES, BASE_BACKOFF_MS, TokenBucket } from '@civic-source/shared';
import {
  COURTLISTENER_BASE_URL,
  SEARCH_ENDPOINT,
  RATE_LIMIT_PER_HOUR,
  DEFAULT_PAGE_SIZE,
} from './constants.js';

/** Raw result shape from the CourtListener search API */
export interface CourtListenerResult {
  caseName: string;
  citation: string[];
  court: string;
  dateFiled: string;
  snippet: string;
  absolute_url: string;
}

/** CourtListener search API response envelope */
interface SearchResponse {
  count: number;
  results: CourtListenerResult[];
}

/** Validate that an unknown value has the expected SearchResponse shape */
function isSearchResponse(data: unknown): data is SearchResponse {
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
    this.rateLimiter = options.rateLimiter ?? new TokenBucket({
      capacity: RATE_LIMIT_PER_HOUR,
      refillRate: Math.ceil(RATE_LIMIT_PER_HOUR / 3600),
      refillIntervalMs: 1000,
    });
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
    if (!isSearchResponse(data)) {
      return ok([]);
    }
    return ok(data.results);
  }

  /** Fetch with exponential backoff retry, including 429 handling */
  private async fetchWithRetry(url: string): Promise<Result<unknown>> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Token ${this.token}` },
        });

        if (response.ok) {
          const data: unknown = await response.json();
          return ok(data);
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
