import { createHash } from 'node:crypto';
import { type IUsCodeFetcher, type ReleasePoint, type Result, ok, err } from '@civic-source/types';
import {
  OLRC_DOWNLOAD_PAGE,
  OLRC_RELEASE_POINTS_URL,
  MAX_RETRIES,
  BASE_BACKOFF_MS,
} from './constants.js';
import { HashStore } from './hash-store.js';
import { type Logger, createLogger } from './logger.js';

/** Compute SHA-256 hex digest of a buffer */
export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Fetch with exponential backoff retry.
 * Retries up to `MAX_RETRIES` times on network/server errors.
 */
export async function fetchWithRetry(
  url: string,
  logger: Logger
): Promise<Result<Response>> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return ok(response);

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn('Server error, retrying', { url, status: response.status, attempt, delayMs });
        await sleep(delayMs);
        continue;
      }
      return err(new Error(`HTTP ${response.status}: ${response.statusText}`));
    } catch (error: unknown) {
      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn('Network error, retrying', { url, attempt, delayMs });
        await sleep(delayMs);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Network error after ${MAX_RETRIES} attempts: ${message}`));
    }
  }
  return err(new Error(`Failed after ${MAX_RETRIES} attempts`));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse release point links from the OLRC download page HTML.
 * Extracts links matching the release points directory pattern.
 */
export function parseReleasePoints(html: string): ReleasePoint[] {
  const results: ReleasePoint[] = [];
  // Match links like: /download/releasepoints/us/pl/118/42/usc42@118-200.zip
  const linkPattern = /href="([^"]*\/releasepoints\/us\/pl\/(\d+)\/(\d+[a-zA-Z]?)\/[^"]*\.zip)"/g;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const [, path, , title] = match;
    const fullUrl = path.startsWith('http')
      ? path
      : `https://uscode.house.gov${path}`;

    results.push({
      title,
      date: new Date().toISOString().slice(0, 10),
      xmlUrl: fullUrl,
    });
  }
  return results;
}

/**
 * OLRC US Code fetcher implementation.
 * Downloads XML release points with hash-based caching and retry logic.
 */
export class OlrcFetcher implements IUsCodeFetcher {
  private readonly logger: Logger;
  private readonly hashStore: HashStore;

  constructor(options?: { logger?: Logger; hashStore?: HashStore }) {
    this.logger = options?.logger ?? createLogger('OlrcFetcher');
    this.hashStore = options?.hashStore ?? new HashStore();
  }

  /** List available release points, optionally filtered by title number */
  async listReleasePoints(title?: string): Promise<Result<ReleasePoint[]>> {
    this.logger.info('Fetching release points', { title });
    const timer = this.logger.startTimer('listReleasePoints');

    const result = await fetchWithRetry(OLRC_DOWNLOAD_PAGE, this.logger);
    if (!result.ok) {
      timer();
      return result;
    }

    const html = await result.value.text();
    let points = parseReleasePoints(html);

    if (title !== undefined) {
      points = points.filter((p) => p.title === title);
    }

    timer();
    this.logger.info('Found release points', { count: points.length });
    return ok(points);
  }

  /** Download and extract XML for a release point with hash-based caching */
  async fetchXml(releasePoint: ReleasePoint): Promise<Result<string>> {
    this.logger.info('Fetching XML', { title: releasePoint.title, url: releasePoint.xmlUrl });
    const timer = this.logger.startTimer('fetchXml');

    const result = await fetchWithRetry(releasePoint.xmlUrl, this.logger);
    if (!result.ok) {
      timer();
      return result;
    }

    const buffer = Buffer.from(await result.value.arrayBuffer());
    const hash = sha256(buffer);
    const hashKey = `xml:${releasePoint.title}:${releasePoint.xmlUrl}`;

    // Check if content has changed since last download
    const changed = await this.hashStore.hasChanged(hashKey, hash);
    if (!changed) {
      this.logger.info('Content unchanged, skipping', { title: releasePoint.title, hash });
      timer();
      return ok('');
    }

    // Validate that we got something that looks like a ZIP (PK signature)
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      timer();
      return err(new Error('Downloaded content is not a valid ZIP file'));
    }

    await this.hashStore.setHash(hashKey, hash);
    timer();

    // Return raw buffer as base64 — caller will extract XML from the ZIP
    return ok(buffer.toString('base64'));
  }
}
