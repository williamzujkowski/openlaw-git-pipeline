import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUslmXml, XmlToMarkdownAdapter } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'usc01-excerpt.xml');
const FIXTURE_XML = readFileSync(FIXTURE_PATH, 'utf-8');

describe('USLM 1.0 (uscDoc) compatibility', () => {
  it('parses uscDoc root element from real OLRC XML', () => {
    const result = parseUslmXml(FIXTURE_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root).toBeDefined();
    expect(Array.isArray(result.value.root)).toBe(true);
  });

  it('extracts title number 1 from identifier', () => {
    const result = parseUslmXml(FIXTURE_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titleNumber).toBe('1');
  });

  it('transforms real OLRC XML into section markdown files', () => {
    const adapter = new XmlToMarkdownAdapter('PL 119-73');
    const result = adapter.transformToFiles(FIXTURE_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Transform failed: ${result.error.message}`);
    }

    // Title 1 Chapter 1 has 2 sections in the excerpt
    expect(result.value.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts section with heading and content', () => {
    const adapter = new XmlToMarkdownAdapter('PL 119-73');
    const result = adapter.transformToFiles(FIXTURE_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const firstSection = result.value[0];
    expect(firstSection).toBeDefined();
    if (!firstSection) return;

    // Section has valid path
    expect(firstSection.path).toMatch(/^statutes\/title-1\/chapter-1\/section-1\.md$/);

    // Section has frontmatter
    expect(firstSection.content).toMatch(/^---\n/);
    expect(firstSection.content).toContain('usc_title: 1');
    expect(firstSection.content).toContain('current_through: "PL 119-73"');

    // Section has heading text
    expect(firstSection.content).toContain('Words denoting number, gender');

    // Section has body content
    expect(firstSection.content).toContain('meaning of any Act of Congress');
  });

  it('extracts multiple sections from the excerpt', () => {
    const adapter = new XmlToMarkdownAdapter('PL 119-73');
    const result = adapter.transformToFiles(FIXTURE_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.path).toContain('section-1.md');
    expect(result.value[1]?.path).toContain('section-2.md');
  });

  it('still handles lawDoc (USLM 2.0) XML correctly', () => {
    const lawDocXml = `
<lawDoc>
  <title identifier="/us/usc/t26">
    <num>Title 26</num>
    <heading>Internal Revenue Code</heading>
    <chapter identifier="/us/usc/t26/ch1">
      <num>Chapter 1</num>
      <section identifier="/us/usc/t26/s101">
        <num>101</num>
        <heading>Certain death benefits</heading>
        <content>Test content.</content>
      </section>
    </chapter>
  </title>
</lawDoc>`;

    const result = parseUslmXml(lawDocXml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titleNumber).toBe('26');

    const adapter = new XmlToMarkdownAdapter();
    const files = adapter.transformToFiles(lawDocXml);
    expect(files.ok).toBe(true);
    if (!files.ok) return;
    expect(files.value).toHaveLength(1);
  });
});
