/** IANA timezone for all date operations */
export const TIMEZONE = 'America/New_York' as const;

/** Maximum retry attempts for network requests */
export const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (doubles each retry) */
export const BASE_BACKOFF_MS = 1000;

/** Maximum backoff delay in ms */
export const MAX_BACKOFF_MS = 30_000;
