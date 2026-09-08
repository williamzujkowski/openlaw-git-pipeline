import { z } from 'zod';

/** CourtListener API v4 base URL */
export const COURTLISTENER_BASE_URL = 'https://www.courtlistener.com/api/rest/v4/';

/** Search endpoint path (appended to base URL) */
export const SEARCH_ENDPOINT = 'search/';

/** CourtListener rate limit: 5000 requests per hour */
export const RATE_LIMIT_PER_HOUR = 5000;

/**
 * Token-bucket config for the CourtListener client.
 *
 * The bucket refills `refillRate` tokens every `refillIntervalMs`, so its
 * sustained rate is `refillRate / refillIntervalMs`. To honour exactly
 * RATE_LIMIT_PER_HOUR/hour we refill one token every (3,600,000 / limit) ms.
 * The previous config (`refillRate: ceil(limit/3600)=2` per 1000 ms) issued
 * ~7200/hour — 44% over the documented cap (#230).
 */
export const COURTLISTENER_RATE_LIMITER = {
  capacity: RATE_LIMIT_PER_HOUR,
  refillRate: 1,
  refillIntervalMs: Math.floor(3_600_000 / RATE_LIMIT_PER_HOUR),
} as const;

/** Environment variable name for the API token */
export const API_TOKEN_ENV_VAR = 'COURTLISTENER_API_TOKEN';

/** Default number of results to return per search */
export const DEFAULT_PAGE_SIZE = 20;

/** Maximum characters for holding summary (truncated from snippet) */
export const MAX_HOLDING_SUMMARY_LENGTH = 500;

/** Maximum characters for a case name (matches CaseAnnotationSchema.caseName) */
export const MAX_CASE_NAME_LENGTH = 500;

/** Maximum characters for a citation (matches CaseAnnotationSchema.citation) */
export const MAX_CITATION_LENGTH = 200;

/**
 * Default court priority for result ordering.
 * SCOTUS opinions are most authoritative, followed by Appellate, then District.
 */
export const COURT_PRIORITY: Record<string, number> = {
  SCOTUS: 0,
  Appellate: 1,
  District: 2,
};

/**
 * Hard cap on a CourtListener API response body, in bytes (#223 item 3).
 *
 * These are JSON search results — a page of opinions is tens of kilobytes.
 * 8 MiB is far above any legitimate response and far below what would
 * threaten the importer, whose failure mode without a cap is an OOM on the
 * runner rather than a handled error.
 *
 * Deliberately NOT the fetcher's MAX_DOWNLOAD_BYTES (300 MiB): that bounds
 * bulk XML downloads, and reusing it here would be a cap in name only.
 */
export const MAX_API_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Validate that the COURTLISTENER_API_TOKEN environment variable is set.
 * Returns the token string or throws a descriptive error.
 */
export function getApiToken(): string {
  const schema = z.string().min(1, `${API_TOKEN_ENV_VAR} environment variable is required`);
  return schema.parse(process.env[API_TOKEN_ENV_VAR]);
}
