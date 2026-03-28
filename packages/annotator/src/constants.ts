import { z } from 'zod';

/** CourtListener API v4 base URL */
export const COURTLISTENER_BASE_URL = 'https://www.courtlistener.com/api/rest/v4/';

/** Search endpoint path (appended to base URL) */
export const SEARCH_ENDPOINT = 'search/';

/** CourtListener rate limit: 5000 requests per hour */
export const RATE_LIMIT_PER_HOUR = 5000;

/** Environment variable name for the API token */
export const API_TOKEN_ENV_VAR = 'COURTLISTENER_API_TOKEN';

/** Maximum retry attempts for network requests */
export const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (doubles each retry) */
export const BASE_BACKOFF_MS = 1000;

/** Default number of results to return per search */
export const DEFAULT_PAGE_SIZE = 20;

/** Maximum characters for holding summary (truncated from snippet) */
export const MAX_HOLDING_SUMMARY_LENGTH = 500;

/** IANA timezone for all date operations */
export const TIMEZONE = 'America/New_York';

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
 * Validate that the COURTLISTENER_API_TOKEN environment variable is set.
 * Returns the token string or throws a descriptive error.
 */
export function getApiToken(): string {
  const schema = z.string().min(1, `${API_TOKEN_ENV_VAR} environment variable is required`);
  return schema.parse(process.env[API_TOKEN_ENV_VAR]);
}
