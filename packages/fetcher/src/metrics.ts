/**
 * Fetcher-level observability metrics.
 *
 * Tracks release point discovery, download success/skip/error, and per-call
 * download duration. Provides a plain-object snapshot for reporting or
 * forwarding to a higher-level pipeline metrics collector.
 */

/** Error type discriminator for download_errors counter. */
export type DownloadErrorType = 'network' | 'non-zip' | 'hash';

/** Point-in-time snapshot of all fetcher metrics. */
export interface FetcherMetricsSnapshot {
  /** Total release points discovered (sum of parseReleasePoints + parsePriorReleasePoints results). */
  releasePointsDiscovered: number;
  /** Successful fetchXml calls that returned new content. */
  releasePointsDownloaded: number;
  /** fetchXml calls skipped because the hash was unchanged (cache hits). */
  releasePointsSkipped: number;
  /** Download errors broken down by type. */
  downloadErrors: {
    /** fetch() threw or returned a non-2xx status. */
    network: number;
    /** Downloaded bytes did not begin with the ZIP PK signature. */
    nonZip: number;
    /** Hash computation or store interaction failed. */
    hash: number;
  };
  /** All recorded per-call download durations in milliseconds, in insertion order. */
  downloadDurationsMs: number[];
}

/** Mutable fetcher metrics collector. */
export class FetcherMetrics {
  private _releasePointsDiscovered = 0;
  private _releasePointsDownloaded = 0;
  private _releasePointsSkipped = 0;
  private readonly _downloadErrors = { network: 0, nonZip: 0, hash: 0 };
  private readonly _downloadDurationsMs: number[] = [];

  /** Increment the release_points_discovered counter by `count`. */
  recordDiscovered(count: number): void {
    this._releasePointsDiscovered += count;
  }

  /** Increment the release_points_downloaded counter by 1. */
  recordDownloaded(): void {
    this._releasePointsDownloaded += 1;
  }

  /** Increment the release_points_skipped counter by 1. */
  recordSkipped(): void {
    this._releasePointsSkipped += 1;
  }

  /**
   * Increment the download_errors counter for the given error type.
   * @param type - 'network' | 'non-zip' | 'hash'
   */
  recordError(type: DownloadErrorType): void {
    if (type === 'network') {
      this._downloadErrors.network += 1;
    } else if (type === 'non-zip') {
      this._downloadErrors.nonZip += 1;
    } else {
      this._downloadErrors.hash += 1;
    }
  }

  /** Append a per-call download duration measurement in milliseconds. */
  recordDuration(durationMs: number): void {
    this._downloadDurationsMs.push(durationMs);
  }

  /**
   * Return an immutable snapshot of all current metrics.
   * The `downloadDurationsMs` array is a shallow copy so callers cannot
   * mutate internal state.
   */
  getSnapshot(): FetcherMetricsSnapshot {
    return {
      releasePointsDiscovered: this._releasePointsDiscovered,
      releasePointsDownloaded: this._releasePointsDownloaded,
      releasePointsSkipped: this._releasePointsSkipped,
      downloadErrors: { ...this._downloadErrors },
      downloadDurationsMs: [...this._downloadDurationsMs],
    };
  }
}
