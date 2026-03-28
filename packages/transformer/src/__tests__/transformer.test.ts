import { describe, it, expect } from 'vitest';
import {
  parseUslmXml,
  extractText,
  generateFrontmatter,
  buildSectionPath,
  formatListItem,
  nestingDepthFor,
  FrontmatterSchema,
  generateSectionBody,
  generateMarkdownForSection,
  XmlToMarkdownAdapter,
} from '../index.js';

// --- Minimal USLM XML fixtures ---

const MINIMAL_SECTION_XML = `
<lawDoc>
  <title identifier="/us/usc/t26">
    <num>Title 26</num>
    <heading>Internal Revenue Code</heading>
    <chapter identifier="/us/usc/t26/ch1">
      <num>Chapter 1</num>
      <heading>Normal Taxes and Surtaxes</heading>
      <section identifier="/us/usc/t26/s101">
        <num>101</num>
        <heading>Certain death benefits</heading>
        <subsection>
          <num>(a)</num>
          <heading>Proceeds of life insurance contracts</heading>
          <content>Gross income does not include amounts received under a life insurance contract.</content>
          <paragraph>
            <num>(1)</num>
            <content>if such amounts are paid by reason of the death of the insured</content>
            <subparagraph>
              <num>(A)</num>
              <content>and such contract was in force at the time of death</content>
              <clause>
                <num>(i)</num>
                <content>under the terms of the contract</content>
              </clause>
            </subparagraph>
          </paragraph>
        </subsection>
      </section>
    </chapter>
  </title>
</lawDoc>`;

const MULTI_SECTION_XML = `
<lawDoc>
  <title identifier="/us/usc/t26">
    <num>Title 26</num>
    <chapter identifier="/us/usc/t26/ch1">
      <num>Chapter 1</num>
      <section identifier="/us/usc/t26/s101">
        <num>101</num>
        <heading>First section</heading>
      </section>
      <section identifier="/us/usc/t26/s102">
        <num>102</num>
        <heading>Second section</heading>
      </section>
    </chapter>
  </title>
</lawDoc>`;

const EMPTY_XML = `<lawDoc><title identifier="/us/usc/t1"><num>Title 1</num></title></lawDoc>`;

// --- Tests ---

describe('parseUslmXml', () => {
  it('parses minimal USLM XML into a structured object', () => {
    const result = parseUslmXml(MINIMAL_SECTION_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root).toBeDefined();
    expect(result.value.titleNumber).toBe('26');
  });

  it('returns error for completely invalid XML', () => {
    const result = parseUslmXml('<<<not xml at all>>>');
    // fast-xml-parser is lenient; it may parse garbage. But missing root elements → error.
    expect(result.ok).toBe(false);
  });

  it('returns error for XML missing expected root elements', () => {
    const result = parseUslmXml('<root><data>hello</data></root>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('missing expected root elements');
  });

  it('extracts title number from identifier attribute', () => {
    const result = parseUslmXml(EMPTY_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.titleNumber).toBe('1');
  });
});

describe('extractText', () => {
  it('returns string values directly', () => {
    expect(extractText('hello')).toBe('hello');
  });

  it('extracts #text from objects', () => {
    expect(extractText({ '#text': 'nested' })).toBe('nested');
  });

  it('returns empty string for null/undefined/unrecognized', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
    expect(extractText({ foo: 'bar' })).toBe('');
  });

  it('handles numeric values', () => {
    expect(extractText(42)).toBe('42');
    expect(extractText({ '#text': 101 })).toBe('101');
  });
});

describe('generateFrontmatter', () => {
  it('produces valid YAML frontmatter', () => {
    const fm = generateFrontmatter({
      title: 'Section 101 - Certain death benefits',
      usc_title: 26,
      usc_section: '101',
      chapter: 1,
      current_through: 'PL 119-73',
      classification: '26 U.S.C. \u00A7 101',
      generated_at: '2026-03-28T14:00:00-04:00',
    });
    expect(fm).toContain('---');
    expect(fm).toContain('title: "Section 101 - Certain death benefits"');
    expect(fm).toContain('usc_title: 26');
    expect(fm).toContain('usc_section: "101"');
    expect(fm).toContain('chapter: 1');
    expect(fm).toContain('current_through: "PL 119-73"');
    expect(fm).toContain('classification: "26 U.S.C.');
  });
});

describe('FrontmatterSchema', () => {
  it('validates correct frontmatter data', () => {
    const result = FrontmatterSchema.safeParse({
      title: 'Section 101',
      usc_title: 26,
      usc_section: '101',
      chapter: 1,
      current_through: 'PL 119-73',
      classification: '26 U.S.C. \u00A7 101',
      generated_at: '2026-03-28T14:00:00-04:00',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid frontmatter (missing required fields)', () => {
    const result = FrontmatterSchema.safeParse({
      title: '',
      usc_title: -1,
    });
    expect(result.success).toBe(false);
  });

  it('applies default for current_through', () => {
    const result = FrontmatterSchema.safeParse({
      title: 'Test',
      usc_title: 1,
      usc_section: '1',
      chapter: 0,
      classification: '1 U.S.C. 1',
      generated_at: 'now',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.current_through).toBe('Unknown');
    }
  });
});

describe('buildSectionPath', () => {
  it('generates correct file path from title/chapter/section', () => {
    expect(buildSectionPath('26', '1', '101')).toBe('title-26/chapter-1/section-101.md');
  });

  it('handles multi-digit numbers', () => {
    expect(buildSectionPath('42', '157', '12345')).toBe('title-42/chapter-157/section-12345.md');
  });
});

describe('formatListItem', () => {
  it('formats top-level item with no indent', () => {
    expect(formatListItem('(a)', 'First item', 0)).toBe('(a) First item');
  });

  it('indents by 2 spaces per depth level', () => {
    expect(formatListItem('(1)', 'Sub item', 1)).toBe('  (1) Sub item');
    expect(formatListItem('(A)', 'Sub sub', 2)).toBe('    (A) Sub sub');
    expect(formatListItem('(i)', 'Deep', 3)).toBe('      (i) Deep');
  });
});

describe('nestingDepthFor', () => {
  it('maps USLM element names to correct depths', () => {
    expect(nestingDepthFor('subsection')).toBe(0);
    expect(nestingDepthFor('paragraph')).toBe(1);
    expect(nestingDepthFor('subparagraph')).toBe(2);
    expect(nestingDepthFor('clause')).toBe(3);
    expect(nestingDepthFor('subclause')).toBe(4);
  });

  it('returns 0 for unknown elements', () => {
    expect(nestingDepthFor('unknown')).toBe(0);
  });
});

describe('generateSectionBody', () => {
  it('generates heading and nested list items from a section node', () => {
    const sectionNode = {
      num: '101',
      heading: 'Test heading',
      subsection: {
        num: '(a)',
        content: 'Top level text',
        paragraph: {
          num: '(1)',
          content: 'Nested text',
        },
      },
    };
    const body = generateSectionBody(sectionNode);
    expect(body).toContain('# 101 Test heading');
    expect(body).toContain('(a) Top level text');
    expect(body).toContain('  (1) Nested text');
  });
});

describe('generateMarkdownForSection', () => {
  it('produces a complete markdown file with frontmatter and body', () => {
    const sectionNode = {
      num: '101',
      heading: 'Certain death benefits',
    };
    const file = generateMarkdownForSection(sectionNode, '26', '1', '101', 'PL 119-73');
    expect(file.path).toBe('title-26/chapter-1/section-101.md');
    expect(file.content).toContain('---');
    expect(file.content).toContain('usc_title: 26');
    expect(file.content).toContain('# 101 Certain death benefits');
  });
});

describe('XmlToMarkdownAdapter', () => {
  it('implements transform() returning combined markdown', () => {
    const adapter = new XmlToMarkdownAdapter('PL 119-73');
    const result = adapter.transform(MINIMAL_SECTION_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('usc_title: 26');
    expect(result.value).toContain('Certain death benefits');
  });

  it('transforms multiple sections', () => {
    const adapter = new XmlToMarkdownAdapter();
    const result = adapter.transformToFiles(MULTI_SECTION_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0].path).toContain('section-101');
    expect(result.value[1].path).toContain('section-102');
  });

  it('handles empty title with no sections gracefully', () => {
    const adapter = new XmlToMarkdownAdapter();
    const result = adapter.transformToFiles(EMPTY_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('returns error for non-USLM XML', () => {
    const adapter = new XmlToMarkdownAdapter();
    const result = adapter.transform('<html><body>Not law</body></html>');
    expect(result.ok).toBe(false);
  });

  it('preserves nested legal list indentation (a)(1)(A)(i)', () => {
    const adapter = new XmlToMarkdownAdapter();
    const result = adapter.transform(MINIMAL_SECTION_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (a) at depth 0 (subsection)
    expect(result.value).toContain('(a)');
    // (1) at depth 1 (paragraph) — 2 spaces
    expect(result.value).toMatch(/^ {2}\(1\)/m);
    // (A) at depth 2 (subparagraph) — 4 spaces
    expect(result.value).toMatch(/^ {4}\(A\)/m);
    // (i) at depth 3 (clause) — 6 spaces
    expect(result.value).toMatch(/^ {6}\(i\)/m);
  });
});
