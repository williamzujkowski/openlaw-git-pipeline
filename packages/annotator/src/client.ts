import { type Result, ok, err } from '@civic-source/types';
import {
  COURTLISTENER_BASE_URL,
  SEARCH_ENDPOINT,
  RATE_LIMIT_PER_HOUR,
  MAX_RETRIES,
  BASE_BACKOFF_MS,
  DEFAULT_PAGE_SIZE,
} from './constants.js';
import { type Logger } from './logger.js';

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

/** Tracks request count for rate limit awareness */
interface RateLimitTracker {
  count: number;
  windowStart: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CourtListener API client with retry logic and rate limit tracking.
 *
 * Note: Statute citations are not indexed as structured fields in CourtListener.
 * We use full-text search (e.g., q="18 U.S.C. 111"), so coverage is approximate.
 */
export class CourtListenerClient {
  private readonly token: string;
  private readonly logger: Logger;
  private readonly pageSize: number;
  private readonly tracker: RateLimitTracker = { count: 0, windowStart: Date.now() };

  constructor(options: { token: string; logger: Logger; pageSize?: number }) {
    this.token = options.token;
    this.logger = options.logger;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  /**
   * Search for opinions mentioning a statute section.
   * Uses full-text search since statute citations are not structured fields.
   */
  async searchByStatute(section: string): Promise<Result<CourtListenerResult[]>> {
    await this.checkRateLimit();

    const url = new URL(SEARCH_ENDPOINT, COURTLISTENER_BASE_URL);
    url.searchParams.set('q', `"${section}"`);
    url.searchParams.set('type', 'o'); // opinions
    url.searchParams.set('order_by', 'dateFiled desc');
    url.searchParams.set('page_size', String(this.pageSize));

    this.logger.info('Searching CourtListener', { section, url: url.toString() });

    const result = await this.fetchWithRetry(url.toString());
    if (!result.ok) return result;

    const data = result.value as SearchResponse;
    return ok(data.results ?? []);
  }

  /** Check rate limit and pause if approaching the threshold */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    if (now - this.tracker.windowStart > hourMs) {
      this.tracker.count = 0;
      this.tracker.windowStart = now;
    }

    // Pause if we're at 90% of the rate limit
    if (this.tracker.count >= RATE_LIMIT_PER_HOUR * 0.9) {
      const waitMs = hourMs - (now - this.tracker.windowStart);
      this.logger.warn('Approaching rate limit, pausing', { waitMs, count: this.tracker.count });
      await sleep(waitMs);
      this.tracker.count = 0;
      this.tracker.windowStart = Date.now();
    }
  }

  /** Fetch with exponential backoff retry, including 429 handling */
  private async fetchWithRetry(url: string): Promise<Result<unknown>> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.tracker.count++;
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
