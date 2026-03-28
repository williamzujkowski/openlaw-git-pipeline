import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { OlrcFetcher, sha256, fetchWithRetry, parseReleasePoints } from '../fetcher.js';
import { HashStore } from '../hash-store.js';
import { createLogger } from '../logger.js';
import type { ReleasePoint } from '@civic-source/types';

// --- sha256 ---

describe('sha256', () => {
  it('returns correct hex digest', () => {
    const buf = Buffer.from('hello');
    const expected = createHash('sha256').update(buf).digest('hex');
    expect(sha256(buf)).toBe(expected);
  });

  it('returns different hashes for different inputs', () => {
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
  });
});

// --- parseReleasePoints ---

describe('parseReleasePoints', () => {
  it('extracts release points from HTML links', () => {
    const html = `
      <a href="/download/releasepoints/us/pl/118/42/usc42@118-200.zip">Title 42</a>
      <a href="/download/releasepoints/us/pl/118/26/usc26@118-200.zip">Title 26</a>
    `;
    const points = parseReleasePoints(html);
    expect(points).toHaveLength(2);
    expect(points[0].title).toBe('42');
    expect(points[0].xmlUrl).toContain('usc42@118-200.zip');
    expect(points[1].title).toBe('26');
  });

  it('returns empty array for HTML with no matching links', () => {
    expect(parseReleasePoints('<html><body>Nothing here</body></html>')).toEqual([]);
  });

  it('handles titles with letter suffixes (e.g., 5a)', () => {
    const html = `<a href="/download/releasepoints/us/pl/118/5a/usc5a@118-200.zip">Title 5a</a>`;
    const points = parseReleasePoints(html);
    expect(points).toHaveLength(1);
    expect(points[0].title).toBe('5a');
  });
});

// --- fetchWithRetry ---

describe('fetchWithRetry', () => {
  const logger = createLogger('test', 'error');

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns response on success', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(true);
  });

  it('retries on 500 errors with exponential backoff', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Internal Server Error' }))
      .mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Internal Server Error' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns error after exhausting retries', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 500, statusText: 'Error' }));

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('500');
    }
  });

  it('retries on network errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await fetchWithRetry('https://example.com', logger);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('3 attempts');
    }
  });
});

// --- HashStore ---

describe('HashStore', () => {
  let store: HashStore;
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    tmpDir = await mkdtemp(join(tmpdir(), 'hashstore-test-'));
    store = new HashStore(tmpDir);
  });

  it('returns undefined for unknown keys', async () => {
    expect(await store.getHash('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves hashes', async () => {
    await store.setHash('key1', 'abc123');
    expect(await store.getHash('key1')).toBe('abc123');
  });

  it('detects when hash has changed', async () => {
    await store.setHash('key1', 'hash-v1');
    expect(await store.hasChanged('key1', 'hash-v1')).toBe(false);
    expect(await store.hasChanged('key1', 'hash-v2')).toBe(true);
  });

  it('reports changed for new keys', async () => {
    expect(await store.hasChanged('new-key', 'any-hash')).toBe(true);
  });

  it('persists across instances', async () => {
    await store.setHash('persist', 'value');
    const store2 = new HashStore(tmpDir);
    expect(await store2.getHash('persist')).toBe('value');
  });
});

// --- OlrcFetcher ---

describe('OlrcFetcher', () => {
  const logger = createLogger('test', 'error');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listReleasePoints fetches and parses the download page', async () => {
    const html = `<a href="/download/releasepoints/us/pl/118/42/usc42@118-200.zip">T42</a>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html, { status: 200 }));

    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.listReleasePoints();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].title).toBe('42');
    }
  });

  it('listReleasePoints filters by title', async () => {
    const html = `
      <a href="/download/releasepoints/us/pl/118/42/usc42@118-200.zip">T42</a>
      <a href="/download/releasepoints/us/pl/118/26/usc26@118-200.zip">T26</a>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html, { status: 200 }));

    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.listReleasePoints('26');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].title).toBe('26');
    }
  });

  it('fetchXml returns error for non-ZIP content', async () => {
    const nonZip = Buffer.from('this is not a zip file at all');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(nonZip, { status: 200 })
    );

    const rp: ReleasePoint = { title: '42', date: '2024-01-01', xmlUrl: 'https://example.com/t42.zip' };
    const fetcher = new OlrcFetcher({ logger });
    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not a valid ZIP');
    }
  });

  it('fetchXml skips download when hash is unchanged', async () => {
    // Create a fake ZIP (starts with PK signature)
    const zipContent = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('fake-zip-data')]);
    const hash = sha256(zipContent);

    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'fetcher-test-'));
    const hashStore = new HashStore(tmpDir);

    const rp: ReleasePoint = { title: '42', date: '2024-01-01', xmlUrl: 'https://example.com/t42.zip' };
    const hashKey = `xml:${rp.title}:${rp.xmlUrl}`;
    await hashStore.setHash(hashKey, hash);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(zipContent, { status: 200 })
    );

    const fetcher = new OlrcFetcher({ logger, hashStore });
    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Empty string means cached/unchanged
      expect(result.value).toBe('');
    }
  });

  it('fetchXml returns base64 content for valid ZIP', async () => {
    const zipContent = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('zip-payload')]);

    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(tmpdir(), 'fetcher-test-'));
    const hashStore = new HashStore(tmpDir);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(zipContent, { status: 200 })
    );

    const rp: ReleasePoint = { title: '42', date: '2024-01-01', xmlUrl: 'https://example.com/t42.zip' };
    const fetcher = new OlrcFetcher({ logger, hashStore });
    const result = await fetcher.fetchXml(rp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      // Verify it's valid base64 that decodes to our content
      const decoded = Buffer.from(result.value, 'base64');
      expect(decoded[0]).toBe(0x50); // P
      expect(decoded[1]).toBe(0x4b); // K
    }
  });
});

// --- Logger ---

describe('createLogger', () => {
  it('startTimer returns elapsed time function', async () => {
    const output: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    };

    try {
      const log = createLogger('test', 'info');
      const done = log.startTimer('operation');
      // Small delay to ensure measurable time
      await new Promise((resolve) => setTimeout(resolve, 5));
      done();

      expect(output.length).toBeGreaterThanOrEqual(1);
      const entry = JSON.parse(output[output.length - 1]) as Record<string, unknown>;
      expect(entry['message']).toBe('operation completed');
      expect(typeof entry['elapsedMs']).toBe('number');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('respects minimum log level', () => {
    const output: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    };

    try {
      const log = createLogger('test', 'warn');
      log.debug('should not appear');
      log.info('should not appear');
      log.warn('should appear');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('should appear');
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
