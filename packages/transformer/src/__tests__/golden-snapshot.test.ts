/**
 * Golden snapshot tests for Title 18 USLM XML transformation.
 *
 * Uses a realistic (but small) USLM 2.0 fixture based on Title 18 — Crimes
 * and Criminal Procedure to verify end-to-end transformation correctness.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XmlToMarkdownAdapter } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixtures', 'title-18-sample.xml');
const fixtureXml = readFileSync(FIXTURE_PATH, 'utf-8');

const adapter = new XmlToMarkdownAdapter('PL 119-73');

describe('Title 18 golden snapshot', () => {
  it('parses the fixture and produces two section files', () => {
    const result = adapter.transformToFiles(fixtureXml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.path).toBe('statutes/title-18/chapter-1/section-1.md');
    expect(result.value[1]?.path).toBe('statutes/title-18/chapter-1/section-2.md');
  });

  it('generates frontmatter with correct fields for section 1', () => {
    const result = adapter.transformToFiles(fixtureXml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const content = result.value[0]!.content;
    expect(content).toContain('---');
    expect(content).toContain('usc_title: 18');
    expect(content).toContain('usc_section: "1"');
    expect(content).toContain('chapter: 1');
    expect(content).toContain('current_through: "PL 119-73"');
    expect(content).toContain('classification: "18 U.S.C.');
  });

  it('produces correct nested list indentation for subsection/paragraph hierarchy', () => {
    const result = adapter.transformToFiles(fixtureXml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const content = result.value[0]!.content;
    // Section heading
    expect(content).toContain('# 1 Offenses classified');
    // (a) at depth 0 — no indent
    expect(content).toMatch(/^\(a\) Notwithstanding any Act of Congress to the contrary:/m);
    // (1) at depth 1 — 2 spaces
    expect(content).toMatch(/^ {2}\(1\) Any offense punishable by death/m);
    // (2) at depth 1 — 2 spaces
    expect(content).toMatch(/^ {2}\(2\) Any other offense is a misdemeanor\./m);
    // (b) at depth 0 — no indent
    expect(content).toMatch(/^\(b\) An offense that is not specifically classified/m);
  });

  it('preserves cross-reference text in mixed content', () => {
    const result = adapter.transformToFiles(fixtureXml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const content = result.value[0]!.content;
    // The <ref> inside subsection (b) should have its text preserved in position
    expect(content).toContain('section 3559');
    expect(content).toMatch(/provided in.*section 3559.*of this title/);
  });

  it('renders section 2 with correct heading and subsections', () => {
    const result = adapter.transformToFiles(fixtureXml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const content = result.value[1]!.content;
    expect(content).toContain('# 2 Principals');
    expect(content).toContain('(a) Whoever commits an offense against the United States');
    expect(content).toContain('(b) Whoever willfully causes an act to be done');
  });

  it('snapshot: section 1 body matches expected markdown structure', () => {
    const result = adapter.transformToFiles(fixtureXml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Extract just the body (after the second --- line)
    const content = result.value[0]!.content;
    const bodyStart = content.indexOf('---', content.indexOf('---') + 1);
    const body = content.slice(bodyStart + 3).trim();

    expect(body).toMatchInlineSnapshot(`
      "# 1 Offenses classified

      (a) Notwithstanding any Act of Congress to the contrary:
        (1) Any offense punishable by death or imprisonment for a term exceeding one year is a felony.
        (2) Any other offense is a misdemeanor.
      (b) An offense that is not specifically classified by a letter grade in the section defining it, as provided in section 3559 of this title, is classified as determined by this section."
    `);
  });
});
