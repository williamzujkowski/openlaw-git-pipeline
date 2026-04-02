import { createHash } from 'node:crypto';
import { type IUsCodeFetcher, type ReleasePoint, type Result, ok, err } from '@civic-source/types';
import { type Logger, createLogger, fetchWithRetry as sharedFetchWithRetry } from '@civic-source/shared';
import { OLRC_DOWNLOAD_PAGE, OLRC_PRIOR_RELEASE_POINTS_PAGE } from './constants.js';
import { HashStore } from './hash-store.js';
import { FetcherMetrics } from './metrics.js';

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
 * Parse the Public Law identifier and date from a prior release points link.
 *
 * Link text format: "Public Law 119-73 (01/23/2026)"
 * Href format: /download/releasepoints/us/pl/119/73/usc-rp@119-73.htm
 *              /download/releasepoints/us/pl/119/73not60/usc-rp@119-73not60.htm
 */
interface ParsedPriorReleasePoint {
  publicLaw: string;
  congress: string;
  law: string;
  dateET: string;
  path: string;
}

/**
 * Parse the prior release points page HTML to extract all historical release points.
 * Returns them in chronological order (oldest first).
 */
export function parsePriorReleasePoints(html: string): ParsedPriorReleasePoint[] {
  const results: ParsedPriorReleasePoint[] = [];

  // Match: <a class="releasepoint" href="/download/releasepoints/us/pl/119/73not60/usc-rp@119-73not60.htm">
  //        Public Law 119-73 (01/23/2026)</a>
  const pattern = /href="(\/download\/releasepoints\/us\/pl\/(\d+)\/([^/]+)\/usc-rp@[^"]+\.htm)"[^>]*>\s*Public\s+Law\s+(\d+-\d+)\s+\((\d{2}\/\d{2}\/\d{4})\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const path = match[1];
    const congress = match[2];
    const law = match[3];
    const publicLawNum = match[4];
    const dateStr = match[5];

    if (!path || !congress || !law || !publicLawNum || !dateStr) continue;

    // Parse MM/DD/YYYY to ISO 8601 datetime in ET
    const [month, day, year] = dateStr.split('/');
    if (!month || !day || !year) continue;
    const isoDate = `${year}-${month}-${day}T00:00:00.000Z`;

    results.push({
      publicLaw: `PL ${publicLawNum}`,
      congress,
      law,
      dateET: isoDate,
      path,
    });
  }

  // Return chronological order (oldest first)
  results.sort((a, b) => a.dateET.localeCompare(b.dateET));
  return results;
}

/**
 * Parse the current release point from the main download page.
 * Extracts the Public Law identifier and date from the page header.
 */
export interface CurrentReleaseInfo {
  publicLaw: string;
  congress: string;
  law: string;
  dateET: string;
}

export function parseCurrentRelease(html: string): CurrentReleaseInfo | undefined {
  // Match: "Public Law 119-73 (01/23/2026)" in the page header
  const headerPattern = /Public\s+Law\s+(\d+)-(\d+)\s+\((\d{2}\/\d{2}\/\d{4})\)/;
  const match = headerPattern.exec(html);
  if (!match) return undefined;

  const congress = match[1];
  const law = match[2];
  const dateStr = match[3];
  if (!congress || !law || !dateStr) return undefined;

  const [month, day, year] = dateStr.split('/');
  if (!month || !day || !year) return undefined;

  return {
    publicLaw: `PL ${congress}-${law}`,
    congress,
    law,
    dateET: `${year}-${month}-${day}T00:00:00.000Z`,
  };
}

/**
 * Parse release point title-level ZIP links from the OLRC download page HTML.
 * Extracts links matching the release points directory pattern.
 */
export function parseReleasePoints(html: string): ReleasePoint[] {
  const results: ReleasePoint[] = [];
  const currentRelease = parseCurrentRelease(html);

  // Match links like: /download/releasepoints/us/pl/118/42/xml_usc42@118-200.zip
  const linkPattern = /href="([^"]*\/releasepoints\/us\/pl\/(\d+)\/([^/]+)\/[^"]*\.zip)"/g;
  let match: RegExpExecArray | null;

  // Extract unique title numbers from XML download links
  const titlePattern = /xml_usc(\d+[a-zA-Z]?)@/;
  const seen = new Set<string>();

  while ((match = linkPattern.exec(html)) !== null) {
    const path = match[1];
    if (!path) continue;

    const titleMatch = titlePattern.exec(path);
    if (!titleMatch) continue;

    const title = titleMatch[1];
    if (!title || seen.has(title)) continue;
    seen.add(title);

    const fullUrl = path.startsWith('http')
      ? path
      : `https://uscode.house.gov${path}`;

    results.push({
      title,
      publicLaw: currentRelease?.publicLaw ?? '',
      dateET: currentRelease?.dateET ?? new Date().toISOString(),
      uslmUrl: fullUrl,
      sha256Hash: '0'.repeat(64),
    });
  }
  return results;
}

/**
 * OLRC US Code fetcher implementation.
 * Downloads XML release points with hash-based caching and retry logic.
 * Supports both current and historical release point enumeration.
 */
export class OlrcFetcher implements IUsCodeFetcher {
  private readonly logger: Logger;
  private readonly hashStore: HashStore;
  readonly metrics: FetcherMetrics;

  constructor(options?: { logger?: Logger; hashStore?: HashStore; metrics?: FetcherMetrics }) {
    this.logger = options?.logger ?? createLogger('OlrcFetcher');
    this.hashStore = options?.hashStore ?? new HashStore();
    this.metrics = options?.metrics ?? new FetcherMetrics();
  }

  /** List available release points from the current download page, optionally filtered by title */
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
    this.metrics.recordDiscovered(points.length);

    if (title !== undefined) {
      points = points.filter((p) => p.title === title);
    }

    timer();
    this.logger.info('Found release points', { count: points.length });
    return ok(points);
  }

  /**
   * List ALL historical release points from the prior release points page.
   * Returns release points in chronological order (oldest first) for
   * deterministic Git history reconstruction.
   */
  async listHistoricalReleasePoints(): Promise<Result<ParsedPriorReleasePoint[]>> {
    this.logger.info('Fetching historical release points index');
    const timer = this.logger.startTimer('listHistoricalReleasePoints');

    // Fetch prior release points page
    const priorResult = await fetchWithRetry(OLRC_PRIOR_RELEASE_POINTS_PAGE, this.logger);
    if (!priorResult.ok) {
      timer();
      return priorResult;
    }

    const priorHtml = await priorResult.value.text();
    const historicalPoints = parsePriorReleasePoints(priorHtml);
    this.metrics.recordDiscovered(historicalPoints.length);

    // Also fetch current release point to include it
    const currentResult = await fetchWithRetry(OLRC_DOWNLOAD_PAGE, this.logger);
    if (currentResult.ok) {
      const currentHtml = await currentResult.value.text();
      const current = parseCurrentRelease(currentHtml);
      if (current) {
        // Add current release if not already in the list
        const alreadyIncluded = historicalPoints.some(
          (p) => p.publicLaw === current.publicLaw
        );
        if (!alreadyIncluded) {
          historicalPoints.push({
            publicLaw: current.publicLaw,
            congress: current.congress,
            law: current.law,
            dateET: current.dateET,
            path: `/download/releasepoints/us/pl/${current.congress}/${current.law}/usc-rp@${current.congress}-${current.law}.htm`,
          });
          // Re-sort after adding current
          historicalPoints.sort((a, b) => a.dateET.localeCompare(b.dateET));
        }
      }
    }

    timer();
    this.logger.info('Found historical release points', { count: historicalPoints.length });
    return ok(historicalPoints);
  }

  /** Download and extract XML for a release point with hash-based caching */
  async fetchXml(releasePoint: ReleasePoint): Promise<Result<string>> {
    this.logger.info('Fetching XML', { title: releasePoint.title, url: releasePoint.uslmUrl });
    const timer = this.logger.startTimer('fetchXml');
    const startMs = performance.now();

    const result = await fetchWithRetry(releasePoint.uslmUrl, this.logger);
    if (!result.ok) {
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordError('network');
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
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordSkipped();
      timer();
      return ok('');
    }

    // Validate that we got something that looks like a ZIP (PK signature)
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      const durationMs = performance.now() - startMs;
      this.metrics.recordDuration(durationMs);
      this.metrics.recordError('non-zip');
      timer();
      return err(new Error('Downloaded content is not a valid ZIP file'));
    }

    await this.hashStore.setHash(hashKey, hash);
    const durationMs = performance.now() - startMs;
    this.metrics.recordDuration(durationMs);
    this.metrics.recordDownloaded();
    timer();

    // Return raw buffer as base64 — caller will extract XML from the ZIP
    return ok(buffer.toString('base64'));
  }
}
