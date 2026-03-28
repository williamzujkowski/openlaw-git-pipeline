import { z } from 'zod';
import { USLM_ELEMENTS, INDENT_PER_LEVEL, MAX_NESTING_DEPTH } from './constants.js';
import { extractText } from './parser.js';

/** Zod schema for YAML frontmatter validation */
export const FrontmatterSchema = z.object({
  title: z.string().min(1),
  usc_title: z.number().int().positive(),
  usc_section: z.string().min(1),
  chapter: z.number().int().nonnegative(),
  current_through: z.string().default('Unknown'),
  classification: z.string().min(1),
  generated_at: z.string().min(1),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/** A generated markdown file with its path and content */
export interface MarkdownFile {
  /** Relative path: title-{n}/chapter-{n}/section-{n}.md */
  path: string;
  /** Full markdown content including frontmatter */
  content: string;
}

/** Build the output file path for a section */
export function buildSectionPath(titleNum: string, chapterNum: string, sectionNum: string): string {
  return `title-${titleNum}/chapter-${chapterNum}/section-${sectionNum}.md`;
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
    '---',
    '',
  ];
  return lines.join('\n');
}

/** Format a legal list item with proper indentation based on depth */
export function formatListItem(marker: string, text: string, depth: number): string {
  const indent = ' '.repeat(Math.min(depth, MAX_NESTING_DEPTH) * INDENT_PER_LEVEL);
  return `${indent}${marker} ${text}`;
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

/** Extract marker text like "(a)" from a num element */
function extractMarker(node: Record<string, unknown>): string {
  const num = node[USLM_ELEMENTS.num] as unknown;
  return extractText(num).trim();
}

/** Extract heading text from a node */
function extractHeading(node: Record<string, unknown>): string {
  const heading = node[USLM_ELEMENTS.heading] as unknown;
  return extractText(heading).trim();
}

/** Extract content/chapeau text from a node */
function extractContent(node: Record<string, unknown>): string {
  const content = node[USLM_ELEMENTS.content] as unknown;
  const chapeau = node[USLM_ELEMENTS.chapeau] as unknown;
  const contentText = extractText(content).trim();
  const chapeauText = extractText(chapeau).trim();
  return chapeauText || contentText;
}

/** Recursively walk nested list elements and generate markdown lines */
function walkListElements(
  node: Record<string, unknown>,
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
    const children = node[elemName];
    if (!children) continue;

    const items = Array.isArray(children) ? children : [children];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const child = item as Record<string, unknown>;
      const marker = extractMarker(child);
      const text = extractContent(child);
      const childDepth = nestingDepthFor(elemName);

      if (marker || text) {
        lines.push(formatListItem(marker, text, childDepth));
      }
      walkListElements(child, depth + 1, lines);
    }
  }
}

/** Generate markdown body for a single section node */
export function generateSectionBody(sectionNode: Record<string, unknown>): string {
  const lines: string[] = [];

  // Section heading
  const heading = extractHeading(sectionNode);
  const sectionNum = extractMarker(sectionNode);
  if (heading) {
    lines.push(`# ${sectionNum ? sectionNum + ' ' : ''}${heading}`);
    lines.push('');
  }

  // Walk nested list elements
  walkListElements(sectionNode, 0, lines);

  // Notes
  const notes = sectionNode[USLM_ELEMENTS.note];
  if (notes) {
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    const noteItems = Array.isArray(notes) ? notes : [notes];
    for (const note of noteItems) {
      const text = typeof note === 'object' && note !== null
        ? extractText(note as Record<string, unknown>)
        : extractText(note);
      if (text) lines.push(text.trim());
    }
  }

  return lines.join('\n');
}

/**
 * Generate a complete markdown file for a section.
 * Returns the MarkdownFile with path and content.
 */
export function generateMarkdownForSection(
  sectionNode: Record<string, unknown>,
  titleNum: string,
  chapterNum: string,
  sectionNum: string,
  currentThrough: string
): MarkdownFile {
  const heading = extractHeading(sectionNode);
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).replace(' ', 'T') + '-04:00';

  const uscTitle = parseInt(titleNum, 10) || 0;
  const chapterInt = parseInt(chapterNum, 10) || 0;

  const frontmatter = FrontmatterSchema.parse({
    title: `Section ${sectionNum}${heading ? ' - ' + heading : ''}`,
    usc_title: Math.max(uscTitle, 1),
    usc_section: sectionNum,
    chapter: chapterInt,
    current_through: currentThrough || 'Unknown',
    classification: `${titleNum} U.S.C. \u00A7 ${sectionNum}`,
    generated_at: now,
  });

  const body = generateSectionBody(sectionNode);
  const content = generateFrontmatter(frontmatter) + '\n' + body + '\n';
  const path = buildSectionPath(titleNum, chapterNum, sectionNum);

  return { path, content };
}
