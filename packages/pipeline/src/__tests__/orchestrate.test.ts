import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result, ReleasePoint } from '@civic-source/types';
import type { MarkdownFile } from '@civic-source/transformer';

// --- Mocks must be declared before the module under test is imported ---

const mockListReleasePoints = vi.fn<() => Promise<Result<ReleasePoint[]>>>();
const mockFetchXml = vi.fn<() => Promise<Result<string>>>();
const mockTransformToFiles = vi.fn<() => Result<MarkdownFile[]>>();
const mockAnnotateSection = vi.fn<() => Promise<Result<{ annotation: unknown; path: string }>>>();

vi.mock('@civic-source/fetcher', () => ({
  OlrcFetcher: vi.fn(function () {
    return {
      listReleasePoints: mockListReleasePoints,
      fetchXml: mockFetchXml,
    };
  }),
  HashStore: vi.fn(function () {
    return {};
  }),
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startTimer: vi.fn(() => vi.fn()),
    logMemory: vi.fn(),
  })),
}));

vi.mock('@civic-source/transformer', () => ({
  XmlToMarkdownAdapter: vi.fn(function () {
    return { transformToFiles: mockTransformToFiles };
  }),
}));

vi.mock('@civic-source/annotator', () => ({
  Annotator: vi.fn(function () {
    return { annotateSection: mockAnnotateSection };
  }),
  annotationToYaml: vi.fn(() => 'targetSection: "1 U.S.C. 1"\n'),
}));

// Mock fs to avoid real disk I/O
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

import { orchestrate } from '../orchestrate.js';

// --- Helpers ---

function makeReleasePoint(overrides?: Partial<ReleasePoint>): ReleasePoint {
  return {
    title: '1',
    publicLaw: 'PL 118-100',
    dateET: '2025-01-01T00:00:00.000Z',
    uslmUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/118/1/xml_usc01@118-100.zip',
    sha256Hash: 'a'.repeat(64),
    ...overrides,
  };
}

function makeMarkdownFile(overrides?: Partial<MarkdownFile>): MarkdownFile {
  return {
    path: 'statutes/title-01/chapter-0/section-1.md',
    content: '---\ntitle: Section 1\n---\n\nBody text here.',
    ...overrides,
  };
}

// --- Tests ---

describe('orchestrate', () => {
  beforeEach(() => {
    mockListReleasePoints.mockReset();
    mockFetchXml.mockReset();
    mockTransformToFiles.mockReset();
    mockAnnotateSection.mockReset();
  });

  it('returns correct metrics on successful orchestration', async () => {
    const rp = makeReleasePoint();
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp] });
    mockFetchXml.mockResolvedValue({ ok: true, value: '<xml>data</xml>' });
    mockTransformToFiles.mockReturnValue({
      ok: true,
      value: [makeMarkdownFile(), makeMarkdownFile({ path: 'statutes/title-01/chapter-0/section-2.md' })],
    });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
      skipAnnotation: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titlesProcessed).toBe(1);
    expect(result.value.totalSectionsTransformed).toBe(2);
    expect(result.value.publicLaw).toBe('PL 118-100');
    expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('isolates single title failure without blocking others', async () => {
    const rp1 = makeReleasePoint({ title: '1' });
    const rp2 = makeReleasePoint({ title: '2' });
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp1, rp2] });

    // Title 1 fails at XML fetch, Title 2 succeeds
    mockFetchXml
      .mockResolvedValueOnce({ ok: false, error: new Error('Network timeout') })
      .mockResolvedValueOnce({ ok: true, value: '<xml>title2</xml>' });

    mockTransformToFiles.mockReturnValue({
      ok: true,
      value: [makeMarkdownFile({ path: 'statutes/title-02/chapter-0/section-1.md' })],
    });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
      skipAnnotation: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Title 1 should be recorded with errors, title 2 should succeed
    expect(result.value.titlesProcessed).toBe(2);
    const title1 = result.value.titleResults.find((t) => t.title === '1');
    const title2 = result.value.titleResults.find((t) => t.title === '2');
    expect(title1?.errors).toHaveLength(1);
    expect(title1?.errors[0]).toContain('Network timeout');
    expect(title2?.sectionsTransformed).toBe(1);
    expect(title2?.errors).toHaveLength(0);
  });

  it('returns early with empty result when no release points exist', async () => {
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [] });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titlesProcessed).toBe(0);
    expect(result.value.totalSectionsTransformed).toBe(0);
    expect(result.value.publicLaw).toBe('None');
  });

  it('propagates release point list failure', async () => {
    mockListReleasePoints.mockResolvedValue({
      ok: false,
      error: new Error('OLRC page unavailable'),
    });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('OLRC page unavailable');
  });

  it('handles empty transform output gracefully', async () => {
    const rp = makeReleasePoint();
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp] });
    mockFetchXml.mockResolvedValue({ ok: true, value: '<xml>empty</xml>' });
    mockTransformToFiles.mockReturnValue({ ok: true, value: [] });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
      skipAnnotation: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titlesProcessed).toBe(1);
    expect(result.value.totalSectionsTransformed).toBe(0);
    expect(result.value.titleResults[0]?.errors).toHaveLength(0);
  });

  it('skips annotation when skipAnnotation is true', async () => {
    const rp = makeReleasePoint();
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp] });
    mockFetchXml.mockResolvedValue({ ok: true, value: '<xml/>' });
    mockTransformToFiles.mockReturnValue({
      ok: true,
      value: [makeMarkdownFile()],
    });

    await orchestrate({
      outputDir: '/tmp/test-output',
      skipAnnotation: true,
    });

    expect(mockAnnotateSection).not.toHaveBeenCalled();
  });

  it('skips unchanged titles (empty XML response)', async () => {
    const rp = makeReleasePoint();
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp] });
    // Empty string means content unchanged (hash match)
    mockFetchXml.mockResolvedValue({ ok: true, value: '' });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
      skipAnnotation: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skippedTitles).toBe(1);
    expect(result.value.titlesProcessed).toBe(0);
    expect(mockTransformToFiles).not.toHaveBeenCalled();
  });

  it('handles transform failure for a title', async () => {
    const rp = makeReleasePoint();
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp] });
    mockFetchXml.mockResolvedValue({ ok: true, value: '<bad-xml/>' });
    mockTransformToFiles.mockReturnValue({
      ok: false,
      error: new Error('No title element found in document'),
    });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
      skipAnnotation: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titlesProcessed).toBe(1);
    const titleResult = result.value.titleResults[0];
    expect(titleResult?.sectionsTransformed).toBe(0);
    expect(titleResult?.errors[0]).toContain('No title element');
  });

  it('filters to requested titles only', async () => {
    const rp1 = makeReleasePoint({ title: '1' });
    const rp2 = makeReleasePoint({ title: '2' });
    const rp3 = makeReleasePoint({ title: '3' });
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp1, rp2, rp3] });
    mockFetchXml.mockResolvedValue({ ok: true, value: '<xml/>' });
    mockTransformToFiles.mockReturnValue({
      ok: true,
      value: [makeMarkdownFile()],
    });

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
      titles: ['1', '3'],
      skipAnnotation: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only titles 1 and 3 should be processed
    expect(mockFetchXml).toHaveBeenCalledTimes(2);
  });
});

describe('isSafePath (via writeMarkdownFile behavior)', () => {
  beforeEach(() => {
    mockListReleasePoints.mockReset();
    mockFetchXml.mockReset();
    mockTransformToFiles.mockReset();
  });

  it('rejects path traversal in file paths', async () => {
    const rp = makeReleasePoint();
    mockListReleasePoints.mockResolvedValue({ ok: true, value: [rp] });
    mockFetchXml.mockResolvedValue({ ok: true, value: '<xml/>' });
    mockTransformToFiles.mockReturnValue({
      ok: true,
      value: [
        makeMarkdownFile({ path: '../../../etc/passwd' }),
        makeMarkdownFile({ path: 'statutes/title-01/chapter-0/section-1.md' }),
      ],
    });

    const { writeFile } = await import('node:fs/promises');

    const result = await orchestrate({
      outputDir: '/tmp/test-output',
      skipAnnotation: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The traversal path should be skipped, only the safe path should be written
    // writeFile is called once for the safe path only
    const writeCalls = vi.mocked(writeFile).mock.calls;
    const writtenPaths = writeCalls.map((call) => String(call[0]));
    expect(writtenPaths.every((p) => !p.includes('etc/passwd'))).toBe(true);
  });
});
