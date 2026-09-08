import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from '@civic-source/shared';

import { CourtListenerClient, isCourtListenerResult, readJsonCapped } from '../client.js';
import { COURTLISTENER_RATE_LIMITER, RATE_LIMIT_PER_HOUR, MAX_API_RESPONSE_BYTES } from '../constants.js';

describe('COURTLISTENER_RATE_LIMITER (#230)', () => {
  it('sustains exactly RATE_LIMIT_PER_HOUR tokens per hour (not the old ~7200)', () => {
    const perHour =
      (3_600_000 / COURTLISTENER_RATE_LIMITER.refillIntervalMs) * COURTLISTENER_RATE_LIMITER.refillRate;
    expect(perHour).toBeLessThanOrEqual(RATE_LIMIT_PER_HOUR);
    expect(perHour).toBe(RATE_LIMIT_PER_HOUR);
  });

  it('caps burst capacity at the hourly limit', () => {
    expect(COURTLISTENER_RATE_LIMITER.capacity).toBe(RATE_LIMIT_PER_HOUR);
  });
});

const VALID = {
  caseName: 'Doe v. United States',
  citation: ['123 U.S. 456'],
  court: 'scotus',
  dateFiled: '2024-01-15',
  snippet: 'The court held that the statute applies broadly.',
  absolute_url: '/opinion/12345/doe-v-united-states/',
};

describe('isCourtListenerResult (#237)', () => {
  it('accepts a fully-formed result', () => {
    expect(isCourtListenerResult(VALID)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isCourtListenerResult(null)).toBe(false);
    expect(isCourtListenerResult('x')).toBe(false);
    expect(isCourtListenerResult(undefined)).toBe(false);
  });

  it('rejects results missing or mistyping required fields', () => {
    const noSnippet: Record<string, unknown> = { ...VALID };
    delete noSnippet['snippet'];
    expect(isCourtListenerResult(noSnippet)).toBe(false);
    expect(isCourtListenerResult({ ...VALID, court: 123 })).toBe(false);
    expect(isCourtListenerResult({ ...VALID, citation: '123 U.S. 456' })).toBe(false); // not an array
    expect(isCourtListenerResult({ ...VALID, citation: [123] })).toBe(false); // non-string element
    expect(isCourtListenerResult({ ...VALID, absolute_url: null })).toBe(false);
  });
});

describe('CourtListenerClient.searchByStatute (#237)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetchJson(body: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response)
    );
  }

  it('drops malformed result elements and returns only well-formed ones', async () => {
    const malformed = { caseName: 'Broken', court: 'scotus' }; // missing snippet/citation/etc.
    stubFetchJson({ count: 2, results: [VALID, malformed] });

    const client = new CourtListenerClient({ token: 't', logger: createLogger('test', 'error') });
    const result = await client.searchByStatute('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.caseName).toBe('Doe v. United States');
  });

  it('returns an empty list when the envelope has no results array', async () => {
    stubFetchJson({ detail: 'unexpected shape' });

    const client = new CourtListenerClient({ token: 't', logger: createLogger('test', 'error') });
    const result = await client.searchByStatute('18 U.S.C. 111');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

describe('readJsonCapped — response size cap (#223 item 3)', () => {
  const CAP = MAX_API_RESPONSE_BYTES;

  /** A Response whose body streams `chunks`, with an optional content-length. */
  function streaming(chunks: Uint8Array[], contentLength?: string): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const headers = new Headers(contentLength === undefined ? {} : { 'content-length': contentLength });
    return new Response(stream, { headers });
  }

  it('parses a normal body', async () => {
    // The benign population: an ordinary search page must still work.
    const body = new TextEncoder().encode(JSON.stringify({ results: [VALID] }));
    const result = await readJsonCapped(streaming([body], String(body.byteLength)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ results: [VALID] });
  });

  it('rejects up-front when Content-Length declares more than the cap', async () => {
    const result = await readJsonCapped(streaming([new Uint8Array(8)], String(CAP + 1)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/declares .* over the .*-byte cap/);
  });

  it('rejects a body that exceeds the cap while streaming, despite an honest-looking Content-Length', async () => {
    // THE case the Content-Length check alone cannot catch: the header is
    // absent or lying, so the only defence is aborting mid-read. Buffering
    // first and checking after would already have spent the memory.
    const chunk = new Uint8Array(1024 * 1024); // 1 MiB
    const chunks = Array.from({ length: 9 }, () => chunk); // 9 MiB > 8 MiB cap
    const result = await readJsonCapped(streaming(chunks, '32'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/exceeded the .*-byte cap/);
  });

  it('returns an error Result for malformed JSON rather than throwing', async () => {
    const body = new TextEncoder().encode('{ not json');
    const result = await readJsonCapped(streaming([body]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/Malformed JSON/);
  });
});
