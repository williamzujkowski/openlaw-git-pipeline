/**
 * Tests for fast-xml-parser mixed content handling with USLM-style XML.
 *
 * Issue #20: Validate whether fast-xml-parser handles USLM-style mixed content
 * correctly — specifically text interleaved with inline elements like <ref> and
 * <quote> inside content nodes.
 *
 * Key finding: The default parser config (no preserveOrder) LOSES interleaved
 * text positions. With preserveOrder: true the library correctly preserves
 * text-node order but returns a different data shape (array-of-objects).
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Parser factories
// ---------------------------------------------------------------------------

/** Current production config from parser.ts — no preserveOrder */
function createDefaultParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    commentPropName: false as unknown as string,
    cdataPropName: false as unknown as string,
    processEntities: { maxEntityCount: 128 },
  });
}

/** Alternate config with preserveOrder for mixed-content correctness */
function createPreserveOrderParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    preserveOrder: true,
    processEntities: { maxEntityCount: 128 },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CROSS_REF_XML = `<section>
  <content>Any person who commits an offense described in <ref href="usc:18:111">section 111</ref> of this title shall be fined under this title.</content>
</section>`;

const SUBSECTION_XML = `<subsection>
  <num>(a)</num>
  <heading>In general</heading>
  <content>The term <quote>employee</quote> means any individual employed by an employer.</content>
</subsection>`;

const AMENDMENT_NOTE_XML = `<note>
  <p>Section 2 of <ref>Pub. L. 109-248</ref>, July 27, 2006, provided that:</p>
  <p>"(a) The Attorney General shall implement this section."</p>
</note>`;

// ---------------------------------------------------------------------------
// Helper: extract ordered text segments from a preserveOrder node array
// ---------------------------------------------------------------------------

type PreserveOrderNode = { '#text': string } | { [tag: string]: PreserveOrderNode[] };

function collectText(nodes: PreserveOrderNode[]): string {
  return nodes
    .map((node) => {
      if ('#text' in node) return (node as { '#text': string })['#text'];
      // recurse into first non-metadata child array
      for (const [key, val] of Object.entries(node)) {
        if (key !== ':@' && Array.isArray(val)) {
          return collectText(val as PreserveOrderNode[]);
        }
      }
      return '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Test suite — default parser (documents the FAILURE mode)
// ---------------------------------------------------------------------------

describe('fast-xml-parser default config — mixed content handling', () => {
  const parser = createDefaultParser();

  describe('Test 1: text with inline cross-references', () => {
    it('parses the section/content node', () => {
      const result = parser.parse(CROSS_REF_XML) as {
        section: { content: { ref: { '#text': string; '@_href': string }; '#text': string } };
      };
      expect(result.section.content).toBeDefined();
    });

    it('FAILS to preserve leading text before <ref> — text is concatenated without the inline element text', () => {
      const result = parser.parse(CROSS_REF_XML) as {
        section: { content: { '#text': string } };
      };
      const rawText = result.section.content['#text'];

      // The default parser concatenates surrounding text nodes into #text but
      // strips out the position of the inline element text.
      // "in <ref>section 111</ref> of" becomes "in of" (section 111 is lost from #text).
      expect(rawText).not.toContain('section 111');

      // The full expected sentence cannot be reconstructed from #text alone.
      const fullExpected =
        'Any person who commits an offense described in section 111 of this title shall be fined under this title.';
      expect(rawText).not.toBe(fullExpected);
    });

    it('stores ref text in a separate nested object — ordering context is lost', () => {
      const result = parser.parse(CROSS_REF_XML) as {
        section: { content: { ref: { '#text': string } } };
      };
      // The ref text IS accessible — it just isn't in the right position
      expect(result.section.content.ref['#text']).toBe('section 111');
    });
  });

  describe('Test 2: mixed text and element children in subsection/content', () => {
    it('parses the subsection', () => {
      const result = parser.parse(SUBSECTION_XML) as {
        subsection: { num: string; heading: string; content: unknown };
      };
      expect(result.subsection.num).toBe('(a)');
      expect(result.subsection.heading).toBe('In general');
    });

    it('FAILS to reconstruct content sentence with inline <quote> in position', () => {
      const result = parser.parse(SUBSECTION_XML) as {
        subsection: { content: { '#text': string; quote: string } };
      };
      const rawText = result.subsection.content['#text'];
      // "The term <quote>employee</quote> means" → rawText = "The termmeans..."
      // The word "employee" is moved to a separate .quote property.
      expect(rawText).not.toContain('employee');

      // Cannot produce the full sentence from #text alone
      const fullExpected =
        'The term employee means any individual employed by an employer.';
      expect(rawText).not.toBe(fullExpected);
    });

    it('stores quote text in a separate property — ordering context lost', () => {
      const result = parser.parse(SUBSECTION_XML) as {
        subsection: { content: { quote: string } };
      };
      expect(result.subsection.content.quote).toBe('employee');
    });
  });

  describe('Test 3: nested amendment notes with inline refs', () => {
    it('parses the note with two <p> elements', () => {
      const result = parser.parse(AMENDMENT_NOTE_XML) as {
        note: { p: unknown[] };
      };
      expect(Array.isArray(result.note.p)).toBe(true);
      expect((result.note.p as unknown[]).length).toBe(2);
    });

    it('FAILS to keep ref text in sentence order for first <p>', () => {
      const result = parser.parse(AMENDMENT_NOTE_XML) as {
        note: { p: [{ '#text': string; ref: string }, string] };
      };
      const firstP = result.note.p[0];
      // "Section 2 of <ref>Pub. L. 109-248</ref>, July 27..." →
      // #text = "Section 2 of, July 27, 2006, provided that:" (ref text excluded)
      expect(firstP['#text']).not.toContain('Pub. L. 109-248');
    });

    it('second <p> (plain text only) parses correctly', () => {
      const result = parser.parse(AMENDMENT_NOTE_XML) as {
        note: { p: [unknown, string] };
      };
      expect(result.note.p[1]).toBe(
        '"(a) The Attorney General shall implement this section."',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite — preserveOrder parser (documents the PASSING mode)
// ---------------------------------------------------------------------------

describe('fast-xml-parser preserveOrder: true — mixed content handling', () => {
  const parser = createPreserveOrderParser();

  describe('Test 1: text with inline cross-references', () => {
    it('preserves all three text segments in document order', () => {
      const result = parser.parse(CROSS_REF_XML) as unknown[];
      // Shape: [ { section: [ { content: [ {#text}, {ref:[{#text}]}, {#text} ] } ] } ]
      const sectionNode = (result[0] as { section: unknown[] }).section;
      const contentChildren = (sectionNode[0] as { content: PreserveOrderNode[] }).content;

      expect(contentChildren).toHaveLength(3);
      expect((contentChildren[0] as { '#text': string })['#text']).toBe(
        'Any person who commits an offense described in',
      );
      expect((contentChildren[2] as { '#text': string })['#text']).toBe(
        'of this title shall be fined under this title.',
      );
    });

    it('preserves the ref text with its attribute in position', () => {
      const result = parser.parse(CROSS_REF_XML) as unknown[];
      const sectionNode = (result[0] as { section: unknown[] }).section;
      const contentChildren = (sectionNode[0] as { content: PreserveOrderNode[] }).content;

      const refNode = contentChildren[1] as unknown as {
        ref: [{ '#text': string }];
        ':@': { '@_href': string };
      };
      expect(refNode.ref[0]['#text']).toBe('section 111');
      expect(refNode[':@']['@_href']).toBe('usc:18:111');
    });

    it('can reconstruct the full sentence in order via collectText()', () => {
      const result = parser.parse(CROSS_REF_XML) as unknown[];
      const sectionNode = (result[0] as { section: unknown[] }).section;
      const contentChildren = (sectionNode[0] as { content: PreserveOrderNode[] }).content;

      const fullText = collectText(contentChildren);
      expect(fullText).toBe(
        'Any person who commits an offense described in section 111 of this title shall be fined under this title.',
      );
    });
  });

  describe('Test 2: mixed text and element children in subsection/content', () => {
    it('preserves num, heading, and content in document order', () => {
      const result = parser.parse(SUBSECTION_XML) as unknown[];
      const subsectionChildren = (result[0] as { subsection: unknown[] }).subsection;

      // subsection contains: num, heading, content (in order)
      expect(subsectionChildren).toHaveLength(3);
      const numNode = subsectionChildren[0] as { num: [{ '#text': string }] };
      const headingNode = subsectionChildren[1] as { heading: [{ '#text': string }] };
      expect(numNode.num[0]['#text']).toBe('(a)');
      expect(headingNode.heading[0]['#text']).toBe('In general');
    });

    it('preserves inline <quote> text in sentence position', () => {
      const result = parser.parse(SUBSECTION_XML) as unknown[];
      const subsectionChildren = (result[0] as { subsection: unknown[] }).subsection;
      const contentChildren = (
        subsectionChildren[2] as { content: PreserveOrderNode[] }
      ).content;

      expect(contentChildren).toHaveLength(3);
      expect((contentChildren[0] as { '#text': string })['#text']).toBe('The term');
      expect(
        (contentChildren[1] as { quote: [{ '#text': string }] }).quote[0]['#text'],
      ).toBe('employee');
      expect((contentChildren[2] as { '#text': string })['#text']).toBe(
        'means any individual employed by an employer.',
      );
    });

    it('can reconstruct the full content sentence via collectText()', () => {
      const result = parser.parse(SUBSECTION_XML) as unknown[];
      const subsectionChildren = (result[0] as { subsection: unknown[] }).subsection;
      const contentChildren = (
        subsectionChildren[2] as { content: PreserveOrderNode[] }
      ).content;

      const fullText = collectText(contentChildren);
      expect(fullText).toBe(
        'The term employee means any individual employed by an employer.',
      );
    });
  });

  describe('Test 3: nested amendment notes with inline refs', () => {
    it('preserves two <p> elements in document order', () => {
      const result = parser.parse(AMENDMENT_NOTE_XML) as unknown[];
      const noteChildren = (result[0] as { note: unknown[] }).note;
      expect(noteChildren).toHaveLength(2);
    });

    it('preserves inline <ref> in position within first <p>', () => {
      const result = parser.parse(AMENDMENT_NOTE_XML) as unknown[];
      const noteChildren = (result[0] as { note: unknown[] }).note;
      const firstPChildren = (noteChildren[0] as { p: PreserveOrderNode[] }).p;

      // p contains: "Section 2 of", <ref>Pub. L. 109-248</ref>, ", July 27..."
      expect(firstPChildren).toHaveLength(3);
      expect((firstPChildren[0] as { '#text': string })['#text']).toBe('Section 2 of');
      expect(
        (firstPChildren[1] as { ref: [{ '#text': string }] }).ref[0]['#text'],
      ).toBe('Pub. L. 109-248');
      expect((firstPChildren[2] as { '#text': string })['#text']).toBe(
        ', July 27, 2006, provided that:',
      );
    });

    it('can reconstruct the first <p> sentence via collectText()', () => {
      const result = parser.parse(AMENDMENT_NOTE_XML) as unknown[];
      const noteChildren = (result[0] as { note: unknown[] }).note;
      const firstPChildren = (noteChildren[0] as { p: PreserveOrderNode[] }).p;

      const fullText = collectText(firstPChildren);
      expect(fullText).toBe(
        'Section 2 of Pub. L. 109-248 , July 27, 2006, provided that:',
      );
    });

    it('second <p> (plain text only) parses correctly', () => {
      const result = parser.parse(AMENDMENT_NOTE_XML) as unknown[];
      const noteChildren = (result[0] as { note: unknown[] }).note;
      const secondPChildren = (noteChildren[1] as { p: [{ '#text': string }] }).p;
      expect(secondPChildren[0]['#text']).toBe(
        '"(a) The Attorney General shall implement this section."',
      );
    });
  });
});
