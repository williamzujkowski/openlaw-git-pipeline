import { describe, it, expect } from 'vitest';
import {
  parseUslmXml,
  extractText,
  generateFrontmatter,
  buildSectionPath,
  formatListItem,
  nestingDepthFor,
  reformatInlineLists,
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

const DEEPLY_NESTED_XML = `
<lawDoc>
  <title identifier="/us/usc/t10">
    <num>Title 10</num>
    <heading>Armed Forces</heading>
    <subtitle identifier="/us/usc/t10/stA">
      <num>Subtitle A</num>
      <heading>General Military Law</heading>
      <part identifier="/us/usc/t10/stA/ptI">
        <num>Part I</num>
        <heading>Organization and General Military Powers</heading>
        <chapter identifier="/us/usc/t10/stA/ptI/ch1">
          <num>1</num>
          <heading>Definitions, Rules of Construction, Cross References, and Related Matters</heading>
          <subchapter identifier="/us/usc/t10/stA/ptI/ch1/schI">
            <num>I</num>
            <heading>Definitions</heading>
            <section identifier="/us/usc/t10/s101">
              <num>101</num>
              <heading>Definitions</heading>
              <content><p>Deep section content</p></content>
            </section>
          </subchapter>
          <section identifier="/us/usc/t10/s102">
            <num>102</num>
            <heading>Purpose</heading>
            <content><p>Direct chapter section</p></content>
          </section>
        </chapter>
        <chapter identifier="/us/usc/t10/stA/ptI/ch2">
          <num>2</num>
          <heading>Department of Defense</heading>
          <section identifier="/us/usc/t10/s111">
            <num>111</num>
            <heading>Executive department</heading>
            <content><p>Chapter 2 section</p></content>
          </section>
        </chapter>
      </part>
    </subtitle>
  </title>
</lawDoc>`;

const EMPTY_XML = `<lawDoc><title identifier="/us/usc/t1"><num>Title 1</num></title></lawDoc>`;

// --- Tests ---

describe('parseUslmXml', () => {
  it('parses minimal USLM XML into a structured array', () => {
    const result = parseUslmXml(MINIMAL_SECTION_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root).toBeDefined();
    expect(Array.isArray(result.value.root)).toBe(true);
    expect(result.value.titleNumber).toBe('26');
  });

  it('returns error for completely invalid XML', () => {
    const result = parseUslmXml('<<<not xml at all>>>');
    // fast-xml-parser is lenient; it may parse garbage. But missing root elements -> error.
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

  it('handles preserveOrder arrays', () => {
    const nodes = [{ '#text': 'hello' }, { '#text': 'world' }];
    expect(extractText(nodes)).toBe('hello world');
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
      status: 'active',
    });
    expect(fm).toContain('---');
    expect(fm).toContain('title: "Section 101 - Certain death benefits"');
    expect(fm).toContain('usc_title: 26');
    expect(fm).toContain('usc_section: "101"');
    expect(fm).toContain('chapter: 1');
    expect(fm).toContain('current_through: "PL 119-73"');
    expect(fm).toContain('classification: "26 U.S.C.');
    expect(fm).toContain('status: "active"');
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
    expect(buildSectionPath('26', '1', '101')).toBe('statutes/title-26/chapter-1/section-101.md');
  });

  it('handles multi-digit numbers', () => {
    expect(buildSectionPath('42', '157', '12345')).toBe('statutes/title-42/chapter-157/section-12345.md');
  });
});

describe('formatListItem', () => {
  it('formats top-level item as markdown list with bold marker', () => {
    expect(formatListItem('(a)', 'First item', 0)).toBe('- **(a)** First item');
  });

  it('indents by 2 spaces per depth level', () => {
    expect(formatListItem('(1)', 'Sub item', 1)).toBe('  - **(1)** Sub item');
    expect(formatListItem('(A)', 'Sub sub', 2)).toBe('    - **(A)** Sub sub');
    expect(formatListItem('(i)', 'Deep', 3)).toBe('      - **(i)** Deep');
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
  it('generates heading and nested list items from preserveOrder children', () => {
    // preserveOrder format: array of single-key objects
    const sectionChildren: unknown[] = [
      { num: [{ '#text': '101' }] },
      { heading: [{ '#text': 'Test heading' }] },
      {
        subsection: [
          { num: [{ '#text': '(a)' }] },
          { content: [{ '#text': 'Top level text' }] },
          {
            paragraph: [
              { num: [{ '#text': '(1)' }] },
              { content: [{ '#text': 'Nested text' }] },
            ],
          },
        ],
      },
    ];
    const body = generateSectionBody(sectionChildren);
    expect(body).toContain('# 101 Test heading');
    expect(body).toContain('- **(a)** Top level text');
    expect(body).toContain('  - **(1)** Nested text');
  });
});

describe('generateMarkdownForSection', () => {
  it('produces a complete markdown file with frontmatter and body', () => {
    const sectionChildren: unknown[] = [
      { num: [{ '#text': '101' }] },
      { heading: [{ '#text': 'Certain death benefits' }] },
    ];
    const file = generateMarkdownForSection(sectionChildren, '26', '1', '101', 'PL 119-73');
    expect(file.path).toBe('statutes/title-26/chapter-1/section-101.md');
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
    expect(result.value[0]?.path).toContain('section-101');
    expect(result.value[1]?.path).toContain('section-102');
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
    // (a) at depth 0 (subsection) — markdown list with bold marker
    expect(result.value).toContain('- **(a)**');
    // (1) at depth 1 (paragraph) — 2 spaces + list marker
    expect(result.value).toMatch(/^ {2}- \*\*\(1\)\*\*/m);
    // (A) at depth 2 (subparagraph) — 4 spaces + list marker
    expect(result.value).toMatch(/^ {4}- \*\*\(A\)\*\*/m);
    // (i) at depth 3 (clause) — 6 spaces + list marker
    expect(result.value).toMatch(/^ {6}- \*\*\(i\)\*\*/m);
  });

  it('handles deeply nested US Code titles (subtitle>part>chapter>subchapter>section)', () => {
    const adapter = new XmlToMarkdownAdapter('PL 119-73');
    const result = adapter.transformToFiles(DEEPLY_NESTED_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should find all 3 sections across the hierarchy
    expect(result.value).toHaveLength(3);

    // Section 101 is inside subtitle>part>chapter>subchapter — should still get chapter 1
    const s101 = result.value.find((f) => f.path.includes('section-101'));
    expect(s101).toBeDefined();
    expect(s101?.path).toBe('statutes/title-10/chapter-1/section-101.md');

    // Section 102 is directly under chapter 1
    const s102 = result.value.find((f) => f.path.includes('section-102'));
    expect(s102).toBeDefined();
    expect(s102?.path).toBe('statutes/title-10/chapter-1/section-102.md');

    // Section 111 is in chapter 2
    const s111 = result.value.find((f) => f.path.includes('section-111'));
    expect(s111).toBeDefined();
    expect(s111?.path).toBe('statutes/title-10/chapter-2/section-111.md');
  });

  it('preserves inline element text in mixed content (cross-references)', () => {
    const xml = `
<lawDoc>
  <title identifier="/us/usc/t18">
    <num>Title 18</num>
    <chapter identifier="/us/usc/t18/ch1">
      <num>Chapter 1</num>
      <section identifier="/us/usc/t18/s1">
        <num>1</num>
        <heading>Offenses</heading>
        <subsection>
          <num>(a)</num>
          <content>Any person who commits an offense described in <ref href="usc:18:111">section 111</ref> of this title shall be fined.</content>
        </subsection>
      </section>
    </chapter>
  </title>
</lawDoc>`;
    const adapter = new XmlToMarkdownAdapter();
    const result = adapter.transform(xml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // With preserveOrder, inline ref text is preserved in position
    expect(result.value).toContain('section 111');
    expect(result.value).toMatch(/described in.*section 111.*of this title shall be fined/);
  });
});

describe('reformatInlineLists', () => {
  it('reformats inline list markers into proper markdown lists', () => {
    const input =
      '(a) First item text here (b) Second item (1) sub item one (2) sub item two (c) Third item';
    const result = reformatInlineLists(input);
    expect(result).toContain('- **(a)** First item text here');
    expect(result).toContain('- **(b)** Second item');
    expect(result).toContain('  - **(1)** sub item one');
    expect(result).toContain('  - **(2)** sub item two');
    expect(result).toContain('- **(c)** Third item');
  });

  it('handles uppercase alpha markers at depth 2', () => {
    const input = '(a) Top level (A) Upper sub one (B) Upper sub two';
    const result = reformatInlineLists(input);
    expect(result).toContain('- **(a)** Top level');
    expect(result).toContain('    - **(A)** Upper sub one');
    expect(result).toContain('    - **(B)** Upper sub two');
  });

  it('handles roman numeral markers at depth 3', () => {
    const input = '(a) Top (i) Roman one (ii) Roman two (iii) Roman three';
    const result = reformatInlineLists(input);
    expect(result).toContain('- **(a)** Top');
    expect(result).toContain('      - **(i)** Roman one');
    expect(result).toContain('      - **(ii)** Roman two');
    expect(result).toContain('      - **(iii)** Roman three');
  });

  it('does not modify lines already formatted as markdown list items', () => {
    const input = '- **(a)** Already formatted\n- **(b)** Also formatted';
    const result = reformatInlineLists(input);
    expect(result).toBe(input);
  });

  it('does not modify headings or empty lines', () => {
    const input = '# Section heading\n\nSome regular text.';
    const result = reformatInlineLists(input);
    expect(result).toBe(input);
  });

  it('does not split lines with fewer than 2 markers', () => {
    const input = 'Only one marker here (a) at the end.';
    const result = reformatInlineLists(input);
    expect(result).toBe(input);
  });

  it('handles the wall-of-text pattern from real data', () => {
    const input =
      '(a) Short title This section may be cited as the "Test Act". (b) Definitions In this section— "term" means something. (c) Program authority (1) In general The Secretary shall allocate funds. (2) Other For any fiscal year.';
    const result = reformatInlineLists(input);
    expect(result).toContain('- **(a)** Short title This section may be cited');
    expect(result).toContain('- **(b)** Definitions In this section');
    expect(result).toContain('- **(c)** Program authority');
    expect(result).toContain('  - **(1)** In general The Secretary shall allocate funds.');
    expect(result).toContain('  - **(2)** Other For any fiscal year.');
  });
});
