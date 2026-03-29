import { describe, it, expect } from 'vitest';
import {
  sanitizeContent,
  sanitizeExcerpt,
  formatTagName,
  extractYear,
  isRateLimited,
} from '../lib/github';

describe('sanitizeContent', () => {
  it('strips basic HTML tags', () => {
    expect(sanitizeContent('<b>bold</b>')).toBe('bold');
  });

  it('strips script blocks entirely', () => {
    expect(sanitizeContent('before<script>alert("xss")</script>after')).toBe('beforeafter');
  });

  it('strips style blocks entirely', () => {
    expect(sanitizeContent('text<style>.evil{}</style>more')).toBe('textmore');
  });

  it('strips HTML comments', () => {
    expect(sanitizeContent('before<!-- hidden instruction -->after')).toBe('beforeafter');
  });

  it('decodes HTML entities and re-strips', () => {
    expect(sanitizeContent('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)');
  });

  it('handles nested/malformed tags', () => {
    expect(sanitizeContent('<div><p>text</p></div>')).toBe('text');
  });

  it('returns plain text unchanged', () => {
    expect(sanitizeContent('just plain text')).toBe('just plain text');
  });
});

describe('sanitizeExcerpt', () => {
  it('preserves mark tags from Pagefind', () => {
    expect(sanitizeExcerpt('text <mark>match</mark> more')).toBe('text <mark>match</mark> more');
  });

  it('strips non-mark tags', () => {
    expect(sanitizeExcerpt('<b>bold</b> <mark>match</mark>')).toBe('bold <mark>match</mark>');
  });

  it('strips script blocks', () => {
    expect(sanitizeExcerpt('<mark>ok</mark><script>evil()</script>')).toBe('<mark>ok</mark>');
  });

  it('handles self-closing mark', () => {
    expect(sanitizeExcerpt('text <mark>highlighted</mark> end')).toBe('text <mark>highlighted</mark> end');
  });
});

describe('formatTagName', () => {
  it('formats pl-113-100 to PL 113-100', () => {
    expect(formatTagName('pl-113-100')).toBe('PL 113-100');
  });
});

describe('extractYear', () => {
  it('derives year from congress number', () => {
    expect(extractYear('', 'pl-113-100')).toBe('2013');
    expect(extractYear('', 'pl-119-73')).toBe('2025');
  });

  it('falls back to date string', () => {
    expect(extractYear('2024-06-15T00:00:00Z')).toBe('2024');
  });

  it('returns empty for no date and no tag', () => {
    expect(extractYear('')).toBe('');
  });
});

describe('isRateLimited', () => {
  it('detects 403 as rate limited', () => {
    expect(isRateLimited({ status: 403 })).toBe(true);
  });

  it('detects 429 as rate limited', () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
  });

  it('returns false for 500', () => {
    expect(isRateLimited({ status: 500 })).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isRateLimited('error')).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });
});
