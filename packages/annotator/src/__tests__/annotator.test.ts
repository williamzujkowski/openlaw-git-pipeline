import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrecedentAnnotationSchema } from '@civic-source/types';
import { createLogger } from '@civic-source/shared';
import { Annotator, mapCourt, buildAnnotationPath, annotationToYaml } from '../annotator.js';
import { CourtListenerClient, type CourtListenerResult } from '../client.js';

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

  it('maps search results to PrecedentAnnotation with path', async () => {
    const client = makeClient([fakeResult()]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.path).toBe('annotations/title-18/section-111.yaml');
    expect(result.value.annotation.targetSection).toBe('18 U.S.C. 111');
    expect(result.value.annotation.cases).toHaveLength(1);
    const firstCase = result.value.annotation.cases[0];
    expect(firstCase).toBeDefined();
    expect(firstCase?.caseName).toBe('Doe v. United States');
    expect(firstCase?.citation).toBe('123 U.S. 456');
    expect(firstCase?.court).toBe('SCOTUS');
    expect(firstCase?.url).toBe(
      'https://www.courtlistener.com/opinion/12345/doe-v-united-states/'
    );
  });

  it('returns valid empty annotation for no results', async () => {
    const client = makeClient([]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('99 U.S.C. 9999');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.annotation.cases).toHaveLength(0);
    expect(result.value.annotation.targetSection).toBe('99 U.S.C. 9999');
    expect(result.value.path).toBe('annotations/title-99/section-9999.yaml');
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
    expect(result.value.annotation.cases[0]?.caseName).toBe('SCOTUS Case');
    expect(result.value.annotation.cases[1]?.caseName).toBe('Appellate Case');
    expect(result.value.annotation.cases[2]?.caseName).toBe('District Case');
  });

  it('truncates snippet to 500 chars for holdingSummary', async () => {
    const longSnippet = 'x'.repeat(600);
    const client = makeClient([fakeResult({ snippet: longSnippet })]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.annotation.cases[0]?.holdingSummary).toHaveLength(503); // 500 + '...'
    expect(result.value.annotation.cases[0]?.holdingSummary.endsWith('...')).toBe(true);
  });

  it('uses first citation when multiple are available', async () => {
    const client = makeClient([
      fakeResult({ citation: ['123 U.S. 456', '789 F.2d 101'] }),
    ]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.annotation.cases[0]?.citation).toBe('123 U.S. 456');
  });

  it('handles empty citation array gracefully', async () => {
    const client = makeClient([fakeResult({ citation: [] })]);
    const annotator = new Annotator({ client, logger });

    const result = await annotator.annotateSection('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.annotation.cases[0]?.citation).toBe('');
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
    const validation = PrecedentAnnotationSchema.safeParse(result.value.annotation);
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
    const calledUrl = calls[0]?.[0] ?? '';
    expect(calledUrl).toContain('q=%2218+U.S.C.+111%22');

    vi.unstubAllGlobals();
  });
});

describe('buildAnnotationPath', () => {
  it('builds path from standard section citation', () => {
    expect(buildAnnotationPath('18 U.S.C. 111')).toBe('annotations/title-18/section-111.yaml');
  });

  it('handles title with letter suffix', () => {
    expect(buildAnnotationPath('26A U.S.C. 501')).toBe('annotations/title-26A/section-501.yaml');
  });

  it('handles section with letter suffix', () => {
    expect(buildAnnotationPath('42 U.S.C. 1983a')).toBe('annotations/title-42/section-1983a.yaml');
  });

  it('falls back to sanitized slug for non-standard citations', () => {
    const path = buildAnnotationPath('Some weird input!');
    expect(path).toMatch(/^annotations\/.*\.yaml$/);
    expect(path).not.toContain('!');
  });
});

describe('annotationToYaml', () => {
  it('serializes annotation to YAML format', () => {
    const yaml = annotationToYaml({
      targetSection: '18 U.S.C. 111',
      lastSyncedET: '2025-06-15T12:00:00.000Z',
      cases: [{
        caseName: 'Doe v. United States',
        citation: '123 U.S. 456',
        court: 'SCOTUS',
        date: '2024-01-15',
        holdingSummary: 'The court held broadly.',
        url: 'https://www.courtlistener.com/opinion/12345/',
      }],
    });
    expect(yaml).toContain('targetSection: "18 U.S.C. 111"');
    expect(yaml).toContain('cases:');
    expect(yaml).toContain('  - caseName: "Doe v. United States"');
    expect(yaml).toContain('    court: "SCOTUS"');
    expect(yaml.endsWith('\n')).toBe(true);
  });

  it('escapes double quotes in values', () => {
    const yaml = annotationToYaml({
      targetSection: '18 U.S.C. 111',
      lastSyncedET: '2025-06-15T12:00:00.000Z',
      cases: [{
        caseName: 'Case with "quotes"',
        citation: '',
        court: 'District',
        date: '2024-01-01',
        holdingSummary: 'Summary with "quotes"',
        url: 'https://example.com',
      }],
    });
    expect(yaml).toContain('caseName: "Case with \\"quotes\\""');
    expect(yaml).toContain('holdingSummary: "Summary with \\"quotes\\""');
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
