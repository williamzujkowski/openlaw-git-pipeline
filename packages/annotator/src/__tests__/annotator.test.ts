import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrecedentAnnotationSchema } from '@civic-source/types';
import { Annotator, mapCourt } from '../annotator.js';
import { CourtListenerClient, type CourtListenerResult } from '../client.js';
import { createLogger } from '../logger.js';

/** Build a fake CourtListener result */
function fakeResult(overrides: Partial<CourtListenerResult> = {}): CourtListenerResult {
  return {
    caseName: 'Doe v. United States',
    citation: ['123 U.S. 456'],
    court: 'scotus',
    dateFiled: '2024-01-15',
    snippet: 'The court held that the statute applies broadly.',
    absolute_url: '/opinion/12345/doe-v-united-states/',
    ...overrides,
  };
}

function makeClient(results: CourtListenerResult[]): CourtListenerClient {
  const logger = createLogger('test', 'error');
  const client = new CourtListenerClient({ token: 'test-token', logger });
  vi.spyOn(client, 'searchByStatute').mockResolvedValue({ ok: true, value: results });
  return client;
}

function makeFailingClient(error: Error): CourtListenerClient {
  const logger = createLogger('test', 'error');
  const client = new CourtListenerClient({ token: 'test-token', logger });
  vi.spyOn(client, 'searchByStatute').mockResolvedValue({ ok: false, error });
  return client;
}

describe('mapCourt', () => {
  it('maps scotus to SCOTUS', () => {
    expect(mapCourt('scotus')).toBe('SCOTUS');
  });

  it('maps appellate courts (ca1, ca2, etc) to Appellate', () => {
    expect(mapCourt('ca1')).toBe('Appellate');
    expect(mapCourt('ca2')).toBe('Appellate');
    expect(mapCourt('ca11')).toBe('Appellate');
    expect(mapCourt('cadc')).toBe('Appellate');
    expect(mapCourt('cafc')).toBe('Appellate');
  });

  it('maps district courts to District', () => {
    expect(mapCourt('paed')).toBe('District');
    expect(mapCourt('nyed')).toBe('District');
    expect(mapCourt('cacd')).toBe('District');
  });

  it('maps unknown courts to District as fallback', () => {
    expect(mapCourt('unknown_court')).toBe('District');
  });
});

describe('Annotator', () => {
  const logger = createLogger('test', 'error');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('maps search results to PrecedentAnnotation', async () => {
    const client = makeClient([fakeResult()]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.targetSection).toBe('18 U.S.C. 111');
    expect(result.value.cases).toHaveLength(1);
    expect(result.value.cases[0].caseName).toBe('Doe v. United States');
    expect(result.value.cases[0].citation).toBe('123 U.S. 456');
    expect(result.value.cases[0].court).toBe('SCOTUS');
    expect(result.value.cases[0].url).toBe(
      'https://www.courtlistener.com/opinion/12345/doe-v-united-states/'
    );
  });

  it('returns valid empty annotation for no results', async () => {
    const client = makeClient([]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('99 U.S.C. 9999');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cases).toHaveLength(0);
    expect(result.value.targetSection).toBe('99 U.S.C. 9999');
  });

  it('sorts results by court priority: SCOTUS > Appellate > District', async () => {
    const results = [
      fakeResult({ court: 'paed', caseName: 'District Case' }),
      fakeResult({ court: 'scotus', caseName: 'SCOTUS Case' }),
      fakeResult({ court: 'ca3', caseName: 'Appellate Case' }),
    ];
    const client = makeClient(results);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cases[0].caseName).toBe('SCOTUS Case');
    expect(result.value.cases[1].caseName).toBe('Appellate Case');
    expect(result.value.cases[2].caseName).toBe('District Case');
  });

  it('truncates snippet to 500 chars for holdingSummary', async () => {
    const longSnippet = 'x'.repeat(600);
    const client = makeClient([fakeResult({ snippet: longSnippet })]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cases[0].holdingSummary).toHaveLength(503); // 500 + '...'
    expect(result.value.cases[0].holdingSummary.endsWith('...')).toBe(true);
  });

  it('uses first citation when multiple are available', async () => {
    const client = makeClient([
      fakeResult({ citation: ['123 U.S. 456', '789 F.2d 101'] }),
    ]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cases[0].citation).toBe('123 U.S. 456');
  });

  it('handles empty citation array gracefully', async () => {
    const client = makeClient([fakeResult({ citation: [] })]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cases[0].citation).toBe('');
  });

  it('propagates client errors', async () => {
    const client = makeFailingClient(new Error('Invalid API token: authentication failed'));
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Invalid API token');
  });

  it('validates output against PrecedentAnnotationSchema', async () => {
    const client = makeClient([fakeResult()]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = PrecedentAnnotationSchema.safeParse(result.value);
    expect(validation.success).toBe(true);
  });
});

describe('CourtListenerClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on 429 rate limit response', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' });
      }
      return new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const logger = createLogger('test', 'error');
    const client = new CourtListenerClient({ token: 'test-token', logger });

    const result = await client.searchByStatute('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);

    vi.unstubAllGlobals();
  });

  it('returns clear error for invalid API token (401)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    }));

    const logger = createLogger('test', 'error');
    const client = new CourtListenerClient({ token: 'bad-token', logger });

    const result = await client.searchByStatute('18 U.S.C. 111');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Invalid API token');

    vi.unstubAllGlobals();
  });

  it('sends Authorization header with token', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const logger = createLogger('test', 'error');
    const client = new CourtListenerClient({ token: 'my-test-token', logger });

    await client.searchByStatute('18 U.S.C. 111');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('search'),
      expect.objectContaining({
        headers: { Authorization: 'Token my-test-token' },
      })
    );

    vi.unstubAllGlobals();
  });

  it('uses full-text search with quoted statute section', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const logger = createLogger('test', 'error');
    const client = new CourtListenerClient({ token: 'test-token', logger });

    await client.searchByStatute('18 U.S.C. 111');

    const calls = mockFetch.mock.calls as unknown as [string, RequestInit][];
    const calledUrl = calls[0][0];
    expect(calledUrl).toContain('q=%2218+U.S.C.+111%22');

    vi.unstubAllGlobals();
  });
});

describe('getApiToken', () => {
  const originalEnv = process.env['COURTLISTENER_API_TOKEN'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['COURTLISTENER_API_TOKEN'] = originalEnv;
    } else {
      delete process.env['COURTLISTENER_API_TOKEN'];
    }
  });

  it('returns token when env var is set', async () => {
    process.env['COURTLISTENER_API_TOKEN'] = 'test-token-value';
    const { getApiToken } = await import('../constants.js');
    expect(getApiToken()).toBe('test-token-value');
  });

  it('throws when env var is not set', async () => {
    delete process.env['COURTLISTENER_API_TOKEN'];
    const { getApiToken } = await import('../constants.js');
    expect(() => getApiToken()).toThrow();
  });
});
