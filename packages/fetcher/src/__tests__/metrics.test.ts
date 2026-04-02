import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FetcherMetrics } from '../metrics.js';
import { OlrcFetcher } from '../fetcher.js';
import { HashStore } from '../hash-store.js';
import { sha256 } from '../fetcher.js';
import { createLogger } from '@civic-source/shared';
import type { ReleasePoint } from '@civic-source/types';

// --- FetcherMetrics unit tests ---

describe('FetcherMetrics', () => {
  let metrics: FetcherMetrics;

  beforeEach(() => {
    metrics = new FetcherMetrics();
  });

  describe('initial snapshot', () => {
    it('starts with all counters at zero', () => {
      const snap = metrics.getSnapshot();
      expect(snap.releasePointsDiscovered).toBe(0);
      expect(snap.releasePointsDownloaded).toBe(0);
      expect(snap.releasePointsSkipped).toBe(0);
      expect(snap.downloadErrors.network).toBe(0);
      expect(snap.downloadErrors.nonZip).toBe(0);
      expect(snap.downloadErrors.hash).toBe(0);
      expect(snap.downloadDurationsMs).toEqual([]);
    });
  });

  describe('recordDiscovered', () => {
    it('increments releasePointsDiscovered by the given count', () => {
      metrics.recordDiscovered(5);
      expect(metrics.getSnapshot().releasePointsDiscovered).toBe(5);
    });

    it('accumulates across multiple calls', () => {
      metrics.recordDiscovered(3);
      metrics.recordDiscovered(7);
      expect(metrics.getSnapshot().releasePointsDiscovered).toBe(10);
    });

    it('accepts zero without changing the counter', () => {
      metrics.recordDiscovered(0);
      expect(metrics.getSnapshot().releasePointsDiscovered).toBe(0);
    });
  });

  describe('recordDownloaded', () => {
    it('increments releasePointsDownloaded by 1', () => {
      metrics.recordDownloaded();
      expect(metrics.getSnapshot().releasePointsDownloaded).toBe(1);
    });

    it('accumulates across multiple calls', () => {
      metrics.recordDownloaded();
      metrics.recordDownloaded();
      metrics.recordDownloaded();
      expect(metrics.getSnapshot().releasePointsDownloaded).toBe(3);
    });
  });

  describe('recordSkipped', () => {
    it('increments releasePointsSkipped by 1', () => {
      metrics.recordSkipped();
      expect(metrics.getSnapshot().releasePointsSkipped).toBe(1);
    });

    it('accumulates across multiple calls', () => {
      metrics.recordSkipped();
      metrics.recordSkipped();
      expect(metrics.getSnapshot().releasePointsSkipped).toBe(2);
    });
  });

  describe('recordError', () => {
    it('increments network error counter', () => {
      metrics.recordError('network');
      expect(metrics.getSnapshot().downloadErrors.network).toBe(1);
      expect(metrics.getSnapshot().downloadErrors.nonZip).toBe(0);
      expect(metrics.getSnapshot().downloadErrors.hash).toBe(0);
    });

    it('increments non-zip error counter', () => {
      metrics.recordError('non-zip');
      expect(metrics.getSnapshot().downloadErrors.nonZip).toBe(1);
      expect(metrics.getSnapshot().downloadErrors.network).toBe(0);
    });

    it('increments hash error counter', () => {
      metrics.recordError('hash');
      expect(metrics.getSnapshot().downloadErrors.hash).toBe(1);
      expect(metrics.getSnapshot().downloadErrors.network).toBe(0);
    });

    it('tracks each error type independently', () => {
      metrics.recordError('network');
      metrics.recordError('network');
      metrics.recordError('non-zip');
      metrics.recordError('hash');
      const snap = metrics.getSnapshot();
      expect(snap.downloadErrors.network).toBe(2);
      expect(snap.downloadErrors.nonZip).toBe(1);
      expect(snap.downloadErrors.hash).toBe(1);
    });
  });

  describe('recordDuration', () => {
    it('appends a duration value', () => {
      metrics.recordDuration(42);
      expect(metrics.getSnapshot().downloadDurationsMs).toEqual([42]);
    });

    it('appends multiple durations in insertion order', () => {
      metrics.recordDuration(10);
      metrics.recordDuration(20);
      metrics.recordDuration(30);
      expect(metrics.getSnapshot().downloadDurationsMs).toEqual([10, 20, 30]);
    });
  });

  describe('getSnapshot isolation', () => {
    it('returns a copy — mutating the returned array does not affect internal state', () => {
      metrics.recordDuration(100);
      const snap = metrics.getSnapshot();
      snap.downloadDurationsMs.push(999);
      expect(metrics.getSnapshot().downloadDurationsMs).toEqual([100]);
    });

    it('returns a copy of downloadErrors — mutating does not affect internal state', () => {
      metrics.recordError('network');
      const snap = metrics.getSnapshot();
      snap.downloadErrors.network = 9999;
      expect(metrics.getSnapshot().downloadErrors.network).toBe(1);
    });
  });
});

// --- OlrcFetcher metrics integration tests ---

describe('OlrcFetcher metrics integration', () => {
  const logger = createLogger('test', 'error');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts an injected FetcherMetrics and exposes it via .metrics', () => {
    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics });
    expect(fetcher.metrics).toBe(metrics);
  });

  it('creates its own FetcherMetrics when none is provided', () => {
    const fetcher = new OlrcFetcher({ logger });
    expect(fetcher.metrics).toBeInstanceOf(FetcherMetrics);
  });

  it('records release_points_discovered from listReleasePoints', async () => {
    const html = `
      <h2>Public Law 118-200 (11/15/2024)</h2>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc42@118-200.zip">T42</a>
      <a href="/download/releasepoints/us/pl/118/200/xml_usc26@118-200.zip">T26</a>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html, { status: 200 }));

    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics });
    await fetcher.listReleasePoints();

    expect(metrics.getSnapshot().releasePointsDiscovered).toBe(2);
  });

  it('records release_points_discovered from listHistoricalReleasePoints', async () => {
    const priorHtml = `
      <a class="releasepoint" href="/download/releasepoints/us/pl/113/21/usc-rp@113-21.htm">
        Public Law 113-21 (07/18/2013)</a>
      <a class="releasepoint" href="/download/releasepoints/us/pl/118/200/usc-rp@118-200.htm">
        Public Law 118-200 (11/15/2024)</a>
    `;
    const currentHtml = `<h2>Public Law 119-73 (01/23/2026)</h2>`;
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(priorHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(currentHtml, { status: 200 }));

    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics });
    await fetcher.listHistoricalReleasePoints();

    // parsePriorReleasePoints returns 2 entries; current adds 1 more but
    // the metrics call happens before dedup/merge, so we record the prior count only.
    expect(metrics.getSnapshot().releasePointsDiscovered).toBe(2);
  });

  it('records release_points_downloaded on successful fetchXml', async () => {
    const zipContent = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('payload')]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(zipContent, { status: 200 })
    );

    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'metrics-test-'));

    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics, hashStore: new HashStore(tmpDir) });
    const rp: ReleasePoint = {
      title: '42',
      publicLaw: 'PL 118-200',
      dateET: '2024-01-01T00:00:00Z',
      uslmUrl: 'https://example.com/t42.zip',
      sha256Hash: '0'.repeat(64),
    };

    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(true);
    expect(metrics.getSnapshot().releasePointsDownloaded).toBe(1);
    expect(metrics.getSnapshot().releasePointsSkipped).toBe(0);
    expect(metrics.getSnapshot().downloadErrors.network).toBe(0);
  });

  it('records release_points_skipped on hash-unchanged fetchXml', async () => {
    const zipContent = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('cached-data')]);
    const hash = sha256(zipContent);

    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'metrics-test-'));
    const hashStore = new HashStore(tmpDir);

    const rp: ReleasePoint = {
      title: '26',
      publicLaw: 'PL 118-200',
      dateET: '2024-01-01T00:00:00Z',
      uslmUrl: 'https://example.com/t26.zip',
      sha256Hash: '0'.repeat(64),
    };
    await hashStore.setHash(`xml:${rp.title}:${rp.uslmUrl}`, hash);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(zipContent, { status: 200 })
    );

    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics, hashStore });
    const result = await fetcher.fetchXml(rp);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('');
    expect(metrics.getSnapshot().releasePointsSkipped).toBe(1);
    expect(metrics.getSnapshot().releasePointsDownloaded).toBe(0);
  });

  it('records network error on fetchXml fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 500, statusText: 'Error' })
    );

    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics });
    const rp: ReleasePoint = {
      title: '1',
      publicLaw: 'PL 118-1',
      dateET: '2024-01-01T00:00:00Z',
      uslmUrl: 'https://example.com/t1.zip',
      sha256Hash: '0'.repeat(64),
    };

    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(false);
    expect(metrics.getSnapshot().downloadErrors.network).toBe(1);
    expect(metrics.getSnapshot().releasePointsDownloaded).toBe(0);
  });

  it('records non-zip error on fetchXml invalid content', async () => {
    const notZip = Buffer.from('this is not a ZIP file');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(notZip, { status: 200 })
    );

    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics });
    const rp: ReleasePoint = {
      title: '5',
      publicLaw: 'PL 118-5',
      dateET: '2024-01-01T00:00:00Z',
      uslmUrl: 'https://example.com/t5.zip',
      sha256Hash: '0'.repeat(64),
    };

    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(false);
    expect(metrics.getSnapshot().downloadErrors.nonZip).toBe(1);
    expect(metrics.getSnapshot().downloadErrors.network).toBe(0);
  });

  it('records download_duration_ms for every fetchXml call', async () => {
    const zipContent = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('data')]);
    // Each Response body can only be read once — use a fresh instance per call.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(zipContent, { status: 200 }))
      .mockResolvedValueOnce(new Response(zipContent, { status: 200 }));

    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'metrics-dur-test-'));

    const metrics = new FetcherMetrics();
    const fetcher = new OlrcFetcher({ logger, metrics, hashStore: new HashStore(tmpDir) });

    const rp1: ReleasePoint = { title: '1', publicLaw: 'PL 118-1', dateET: '2024-01-01T00:00:00Z', uslmUrl: 'https://example.com/t1.zip', sha256Hash: '0'.repeat(64) };
    const rp2: ReleasePoint = { title: '2', publicLaw: 'PL 118-1', dateET: '2024-01-01T00:00:00Z', uslmUrl: 'https://example.com/t2.zip', sha256Hash: '0'.repeat(64) };

    await fetcher.fetchXml(rp1);
    await fetcher.fetchXml(rp2);

    const snap = metrics.getSnapshot();
    expect(snap.downloadDurationsMs).toHaveLength(2);
    for (const d of snap.downloadDurationsMs) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });
});
