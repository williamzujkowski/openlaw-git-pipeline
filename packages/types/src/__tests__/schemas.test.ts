import { describe, it, expect } from 'vitest';
import {
  ReleasePointSchema,
  CaseAnnotationSchema,
  PrecedentAnnotationSchema,
  PrecedentImpactSchema,
  ok,
  err,
} from '../index.js';

describe('Result helpers', () => {
  it('ok wraps a value', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('err wraps an error', () => {
    const result = err(new Error('fail'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('fail');
  });
});

describe('ReleasePointSchema', () => {
  const valid = {
    title: '18',
    publicLaw: 'PL 119-73',
    dateET: '2026-01-15T12:00:00Z',
    uslmUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
    sha256Hash: 'a'.repeat(64),
  };

  it('accepts a valid release point', () => {
    expect(ReleasePointSchema.parse(valid)).toEqual(valid);
  });

  it('rejects empty title', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, title: '' })).toThrow();
  });

  it('rejects invalid URL', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, uslmUrl: 'not-a-url' })).toThrow();
  });

  it('rejects wrong-length sha256Hash', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, sha256Hash: 'abc' })).toThrow();
  });

  it('rejects invalid dateET format', () => {
    expect(() => ReleasePointSchema.parse({ ...valid, dateET: 'March 15' })).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => ReleasePointSchema.parse({ title: '1' })).toThrow();
  });
});

describe('PrecedentImpactSchema', () => {
  it('accepts valid impacts', () => {
    for (const impact of ['interpretation', 'unconstitutional', 'narrowed', 'historical']) {
      expect(PrecedentImpactSchema.parse(impact)).toBe(impact);
    }
  });

  it('rejects invalid impact', () => {
    expect(() => PrecedentImpactSchema.parse('overturned')).toThrow();
  });
});

describe('CaseAnnotationSchema', () => {
  const valid = {
    caseName: 'United States v. Smith',
    citation: '500 U.S. 123 (2020)',
    court: 'SCOTUS' as const,
    date: '2020-06-15',
    holdingSummary: 'Held that the statute applies to federal officers.',
    sourceUrl: 'https://courtlistener.com/opinion/12345/',
    impact: 'interpretation' as const,
  };

  it('accepts valid case annotation', () => {
    expect(CaseAnnotationSchema.parse(valid)).toEqual(valid);
  });

  it('accepts optional statuteVersionRef', () => {
    const withRef = { ...valid, statuteVersionRef: 'PL 117-81', statuteVersionNote: 'Current at time of decision' };
    expect(CaseAnnotationSchema.parse(withRef)).toEqual(withRef);
  });

  it('rejects invalid court', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, court: 'State' })).toThrow();
  });

  it('rejects holdingSummary over 500 chars', () => {
    expect(() => CaseAnnotationSchema.parse({ ...valid, holdingSummary: 'x'.repeat(501) })).toThrow();
  });

  it('accepts holdingSummary at exactly 500 chars', () => {
    const atLimit = { ...valid, holdingSummary: 'x'.repeat(500) };
    expect(CaseAnnotationSchema.parse(atLimit).holdingSummary).toHaveLength(500);
  });
});

describe('PrecedentAnnotationSchema', () => {
  it('accepts valid annotation with cases', () => {
    const annotation = {
      targetSection: '18 U.S.C. § 111',
      lastSyncedET: '2026-03-29T18:00:00Z',
      cases: [{
        caseName: 'United States v. Doe',
        citation: '600 U.S. 1 (2025)',
        court: 'SCOTUS' as const,
        date: '2025-01-01',
        holdingSummary: 'Test holding',
        sourceUrl: 'https://example.com/case',
        impact: 'interpretation' as const,
      }],
    };
    const result = PrecedentAnnotationSchema.parse(annotation);
    expect(result.cases).toHaveLength(1);
    expect(result.targetSection).toBe('18 U.S.C. § 111');
  });

  it('accepts empty cases array', () => {
    const annotation = {
      targetSection: '26 U.S.C. § 1',
      lastSyncedET: '2026-01-01T00:00:00Z',
      cases: [],
    };
    expect(PrecedentAnnotationSchema.parse(annotation).cases).toHaveLength(0);
  });

  it('rejects invalid lastSyncedET', () => {
    expect(() => PrecedentAnnotationSchema.parse({
      targetSection: 'test',
      lastSyncedET: 'not-a-date',
      cases: [],
    })).toThrow();
  });
});
