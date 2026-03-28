import { createHash } from 'node:crypto';
import { type IUsCodeFetcher, type ReleasePoint, type Result, ok, err } from '@civic-source/types';
import { type Logger, createLogger, fetchWithRetry as sharedFetchWithRetry } from '@civic-source/shared';
import { OLRC_DOWNLOAD_PAGE } from './constants.js';
import { HashStore } from './hash-store.js';

/** Compute SHA-256 hex digest of a buffer */
export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Fetch with exponential backoff retry.
 * Delegates to the shared fetchWithRetry utility.
 */
export async function fetchWithRetry(
  url: string,
  logger: Logger
): Promise<Result<Response>> {
  return sharedFetchWithRetry(url, { logger });
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
    const path = match[1];
    const title = match[3];
    if (!path || !title) continue;
    const fullUrl = path.startsWith('http')
      ? path
      : `https://uscode.house.gov${path}`;

    results.push({
      title,
      publicLaw: '',
      dateET: new Date().toISOString(),
      uslmUrl: fullUrl,
      sha256Hash: '0'.repeat(64),
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
    this.logger.info('Fetching XML', { title: releasePoint.title, url: releasePoint.uslmUrl });
    const timer = this.logger.startTimer('fetchXml');

    const result = await fetchWithRetry(releasePoint.uslmUrl, this.logger);
    if (!result.ok) {
      timer();
      return result;
    }

    const buffer = Buffer.from(await result.value.arrayBuffer());
    const hash = sha256(buffer);
    const hashKey = `xml:${releasePoint.title}:${releasePoint.uslmUrl}`;

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
