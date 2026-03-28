import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, TIMEZONE, MAX_RETRIES, BASE_BACKOFF_MS, MAX_BACKOFF_MS, fetchWithRetry } from '../index.js';

describe('constants', () => {
  it('exports TIMEZONE as America/New_York', () => {
    expect(TIMEZONE).toBe('America/New_York');
  });

  it('exports MAX_RETRIES as 3', () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it('exports BASE_BACKOFF_MS as 1000', () => {
    expect(BASE_BACKOFF_MS).toBe(1000);
  });

  it('exports MAX_BACKOFF_MS as 30000', () => {
    expect(MAX_BACKOFF_MS).toBe(30_000);
  });
});

describe('createLogger', () => {
  it('creates a logger with all expected methods', () => {
    const logger = createLogger('test');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.startTimer).toBe('function');
    expect(typeof logger.logMemory).toBe('function');
  });

  it('emits JSON to stdout for info level', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger('test-component');
    logger.info('hello world', { extra: 42 });

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0]![0] as string;
    const parsed: Record<string, unknown> = JSON.parse(output.trim());
    expect(parsed['level']).toBe('info');
    expect(parsed['message']).toBe('hello world');
    expect(parsed['component']).toBe('test-component');
    expect(parsed['extra']).toBe(42);

    writeSpy.mockRestore();
  });

  it('emits JSON to stderr for error level', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const logger = createLogger('test-err');
    logger.error('something broke');

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0]![0] as string;
    const parsed: Record<string, unknown> = JSON.parse(output.trim());
    expect(parsed['level']).toBe('error');

    writeSpy.mockRestore();
  });

  it('respects minimum log level filtering', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger('test', 'warn');
    logger.debug('should be filtered');
    logger.info('should be filtered too');

    expect(writeSpy).not.toHaveBeenCalled();

    writeSpy.mockRestore();
  });

  it('startTimer returns a function that logs elapsed time', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger('timer-test');
    const stop = logger.startTimer('my-op');
    stop();

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0]![0] as string;
    const parsed: Record<string, unknown> = JSON.parse(output.trim());
    expect(parsed['message']).toBe('my-op completed');
    expect(typeof parsed['elapsedMs']).toBe('number');

    writeSpy.mockRestore();
  });

  it('logMemory logs heap usage', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = createLogger('mem-test');
    logger.logMemory();

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0]![0] as string;
    const parsed: Record<string, unknown> = JSON.parse(output.trim());
    expect(parsed['message']).toBe('Memory usage');
    expect(typeof parsed['heapUsedMB']).toBe('number');
    expect(typeof parsed['rssMB']).toBe('number');

    writeSpy.mockRestore();
  });
});

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns ok result on successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('OK', { status: 200 });
    }));

    const result = await fetchWithRetry('https://example.com');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(200);
  });

  it('retries on 500 server error and succeeds on second attempt', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Server Error', { status: 500, statusText: 'Internal Server Error' });
      }
      return new Response('OK', { status: 200 });
    }));

    const result = await fetchWithRetry('https://example.com', {
      baseDelayMs: 1,
    });
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  it('returns error after exhausting all retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('Server Error', { status: 500, statusText: 'Internal Server Error' });
    }));

    const result = await fetchWithRetry('https://example.com', {
      maxRetries: 2,
      baseDelayMs: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('500');
  });

  it('retries on network errors', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('ECONNRESET');
      return new Response('OK', { status: 200 });
    }));

    const result = await fetchWithRetry('https://example.com', {
      baseDelayMs: 1,
    });
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  it('returns error for non-retryable status codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }));

    const result = await fetchWithRetry('https://example.com');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('404');
  });

  it('passes request options through to fetch', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('OK', { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchWithRetry('https://example.com', {
      headers: { Authorization: 'Bearer test' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test' },
      })
    );
  });
});
