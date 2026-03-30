import { z } from 'zod';
import { USLM_ELEMENTS, INDENT_PER_LEVEL, MAX_NESTING_DEPTH } from './constants.js';
import { extractTextFromNodes, findElements } from './xml-utils.js';

/** Section status — derived from heading text during transformation */
export const SectionStatusSchema = z.enum([
  'active', 'repealed', 'reserved', 'omitted', 'transferred', 'renumbered',
]);

export type SectionStatus = z.infer<typeof SectionStatusSchema>;

/** Zod schema for YAML frontmatter validation */
export const FrontmatterSchema = z.object({
  title: z.string().min(1),
  usc_title: z.number().int().positive(),
  usc_section: z.string().min(1),
  chapter: z.number().int().nonnegative(),
  current_through: z.string().default('Unknown'),
  classification: z.string().min(1),
  generated_at: z.string().min(1),
  status: SectionStatusSchema.default('active'),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/** Detect section status from heading text */
export function detectSectionStatus(heading: string): SectionStatus {
  if (heading.includes('Repealed')) return 'repealed';
  if (heading.includes('Reserved')) return 'reserved';
  if (heading.includes('Omitted')) return 'omitted';
  if (heading.includes('Renumbered')) return 'renumbered';
  if (heading.includes('Transferred') && !heading.includes('Transferred or reemployed')) return 'transferred';
  return 'active';
}

/** A generated markdown file with its path and content */
export interface MarkdownFile {
  /** Relative path: statutes/title-{n}/chapter-{n}/section-{n}.md */
  path: string;
  /** Full markdown content including frontmatter */
  content: string;
}

/**
 * Pattern to detect inline legal list markers like (a), (b), (1), (A), (i), (ii).
 * Matches when preceded by whitespace (or start of string).
 * Groups: full match includes leading space; capture group 1 is the marker itself.
 */
const INLINE_MARKER_PATTERN =
  /(?<=\s)(\([a-z]\)|\(\d{1,2}\)|\([A-Z]\)|\([ivxlcdm]+\))\s/g;

/**
 * Determine indentation depth for an inline marker based on its type.
 * - (a)-(z) lowercase alpha → depth 0
 * - (1)-(99) numeric → depth 1
 * - (A)-(Z) uppercase alpha → depth 2
 * - (i)-(xx) lowercase roman → depth 3
 */
function markerDepth(marker: string): number {
  const inner = marker.slice(1, -1); // strip parens
  if (/^\d{1,2}$/.test(inner)) return 1;     // (1)-(99)
  if (/^[A-Z]$/.test(inner)) return 2;       // (A)-(Z)
  // Multi-char roman numerals are unambiguous: (ii), (iii), (iv), (vi), etc.
  // Single-char (i), (v), (x) are treated as roman per legal convention
  // (legal alpha lists rarely reach these letters before switching to roman)
  if (/^[ivxlcdm]{2,}$/.test(inner)) return 3;  // (ii), (iii), (iv), etc.
  if (/^[ivx]$/.test(inner)) return 3;           // (i), (v), (x) — roman
  if (/^[a-z]$/.test(inner)) return 0;           // (a)-(h), (j)-(z)
  return 0;
}

/**
 * Reformat inline legal list markers into proper markdown list items.
 *
 * Detects lines containing multiple inline markers like:
 *   "(a) Definitions In this section— ... (b) First offense ..."
 * and splits them into separate markdown list items with correct indentation.
 *
 * Only processes lines that don't already contain `- **` markers.
 */
export function reformatInlineLists(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    // Skip lines already formatted as markdown list items
    if (/^\s*- \*\*/.test(line)) {
      result.push(line);
      continue;
    }

    // Skip headings and empty lines
    if (line.startsWith('#') || line.trim() === '') {
      result.push(line);
      continue;
    }

    // Collect all marker positions: { offset, fullMatch, marker }
    const markers: Array<{ offset: number; fullLength: number; marker: string }> = [];

    // Check for marker at start of string (no preceding whitespace)
    const startMatch = line.match(/^(\([a-z]\)|\(\d{1,2}\)|\([A-Z]\)|\([ivxlcdm]+\))\s/);
    if (startMatch) {
      markers.push({ offset: 0, fullLength: startMatch[0].length, marker: startMatch[1] ?? '' });
    }

    // Collect inline markers preceded by whitespace
    INLINE_MARKER_PATTERN.lastIndex = 0;
    let inlineMatch: RegExpExecArray | null;
    while ((inlineMatch = INLINE_MARKER_PATTERN.exec(line)) !== null) {
      markers.push({
        offset: inlineMatch.index,
        fullLength: inlineMatch[0].length,
        marker: inlineMatch[1] ?? '',
      });
    }

    if (markers.length < 2) {
      result.push(line);
      continue;
    }

    // Split line at each marker position
    for (let idx = 0; idx < markers.length; idx++) {
      const entry = markers[idx];
      if (!entry) continue;

      const depth = markerDepth(entry.marker);
      const indent = ' '.repeat(depth * INDENT_PER_LEVEL);

      // Text runs from after this marker to the start of the next marker (or end of line)
      const textStart = entry.offset + entry.fullLength;
      const nextEntry = markers[idx + 1];
      const textEnd = nextEntry !== undefined ? nextEntry.offset : line.length;
      const itemText = line.slice(textStart, textEnd).trim();

      result.push(`${indent}- **${entry.marker}** ${itemText}`);
    }
  }

  return result.join('\n');
}

/** Build the output file path for a section */
export function buildSectionPath(titleNum: string, chapterNum: string, sectionNum: string): string {
  return `statutes/title-${titleNum}/chapter-${chapterNum}/section-${sectionNum}.md`;
}

/** Generate YAML frontmatter string from validated data */
export function generateFrontmatter(data: Frontmatter): string {
  const lines = [
    '---',
    `title: "${data.title}"`,
    `usc_title: ${data.usc_title}`,
    `usc_section: "${data.usc_section}"`,
    `chapter: ${data.chapter}`,
    `current_through: "${data.current_through}"`,
    `classification: "${data.classification}"`,
    `generated_at: "${data.generated_at}"`,
    `status: "${data.status}"`,
    '---',
    '',
  ];
  return lines.join('\n');
}

/** Format a legal list item as a markdown unordered list entry with bold marker */
export function formatListItem(marker: string, text: string, depth: number): string {
  const indent = ' '.repeat(Math.min(depth, MAX_NESTING_DEPTH) * INDENT_PER_LEVEL);
  const boldMarker = marker ? `**${marker}**` : '';
  return `${indent}- ${boldMarker}${text ? ' ' + text : ''}`;
}

/**
 * Determine nesting depth for a USLM element type.
 * subsection=0, paragraph=1, subparagraph=2, clause=3, subclause=4
 */
export function nestingDepthFor(elementName: string): number {
  const depthMap: Record<string, number> = {
    [USLM_ELEMENTS.subsection]: 0,
    [USLM_ELEMENTS.paragraph]: 1,
    [USLM_ELEMENTS.subparagraph]: 2,
    [USLM_ELEMENTS.clause]: 3,
    [USLM_ELEMENTS.subclause]: 4,
  };
  return depthMap[elementName] ?? 0;
}

/** Extract marker text like "(a)" from a num element within node children */
function extractMarker(children: unknown[]): string {
  const nums = findElements(children, USLM_ELEMENTS.num);
  const first = nums[0];
  if (!first) return '';
  return extractTextFromNodes(first.children).trim();
}

/** Extract heading text from node children */
function extractHeading(children: unknown[]): string {
  const headings = findElements(children, USLM_ELEMENTS.heading);
  const first = headings[0];
  if (!first) return '';
  return extractTextFromNodes(first.children).trim();
}

/** Extract content/chapeau text from node children */
function extractContent(children: unknown[]): string {
  const firstChapeau = findElements(children, USLM_ELEMENTS.chapeau)[0];
  if (firstChapeau) {
    return extractTextFromNodes(firstChapeau.children).trim();
  }
  const firstContent = findElements(children, USLM_ELEMENTS.content)[0];
  if (firstContent) {
    return extractTextFromNodes(firstContent.children).trim();
  }
  return '';
}

/** Recursively walk nested list elements and generate markdown lines */
function walkListElements(
  children: unknown[],
  depth: number,
  lines: string[]
): void {
  if (depth > MAX_NESTING_DEPTH) return;

  const listElements = [
    USLM_ELEMENTS.subsection,
    USLM_ELEMENTS.paragraph,
    USLM_ELEMENTS.subparagraph,
    USLM_ELEMENTS.clause,
    USLM_ELEMENTS.subclause,
  ];

  for (const elemName of listElements) {
    const items = findElements(children, elemName);
    for (const item of items) {
      const marker = extractMarker(item.children);
      const text = extractContent(item.children);
      const childDepth = nestingDepthFor(elemName);

      if (marker || text) {
        lines.push(formatListItem(marker, text, childDepth));
      }
      walkListElements(item.children, depth + 1, lines);
    }
  }
}

/** Generate markdown body for a single section node (preserveOrder children) */
export function generateSectionBody(sectionChildren: unknown[]): string {
  const lines: string[] = [];

  // Section heading
  const heading = extractHeading(sectionChildren);
  const sectionNum = extractMarker(sectionChildren);
  if (heading) {
    lines.push(`# ${sectionNum ? sectionNum + ' ' : ''}${heading}`);
    lines.push('');
  }

  // Direct content under section (USLM 1.0 sections may have <content> without subsections)
  const directContent = extractContent(sectionChildren);
  if (directContent) {
    lines.push(directContent);
    lines.push('');
  }

  // Walk nested list elements
  walkListElements(sectionChildren, 0, lines);

  // Notes
  const notes = findElements(sectionChildren, USLM_ELEMENTS.note);
  if (notes.length > 0) {
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    for (const note of notes) {
      const text = extractTextFromNodes(note.children).trim();
      if (text) lines.push(text);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a complete markdown file for a section.
 * sectionChildren is the children array of the section element in preserveOrder format.
 * Returns the MarkdownFile with path and content.
 */
export function generateMarkdownForSection(
  sectionChildren: unknown[],
  titleNum: string,
  chapterNum: string,
  sectionNum: string,
  currentThrough: string
): MarkdownFile {
  const heading = extractHeading(sectionChildren);
  const now = new Date().toISOString();

  const uscTitle = parseInt(titleNum, 10) || 0;
  const chapterInt = parseInt(chapterNum, 10) || 0;

  const sectionTitle = `Section ${sectionNum}${heading ? ' - ' + heading : ''}`;
  const frontmatter = FrontmatterSchema.parse({
    title: sectionTitle,
    usc_title: Math.max(uscTitle, 1),
    usc_section: sectionNum,
    chapter: chapterInt,
    current_through: currentThrough || 'Unknown',
    classification: `${titleNum} U.S.C. \u00A7 ${sectionNum}`,
    generated_at: now,
    status: detectSectionStatus(sectionTitle),
  });

  let body = generateSectionBody(sectionChildren);

  // Post-process: reformat inline list markers if body isn't already formatted
  if (!body.includes('- **')) {
    body = reformatInlineLists(body);
  }

  const content = generateFrontmatter(frontmatter) + '\n' + body + '\n';
  const path = buildSectionPath(titleNum, chapterNum, sectionNum);

  return { path, content };
}
