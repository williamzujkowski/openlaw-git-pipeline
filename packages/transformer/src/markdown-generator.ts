import { z } from 'zod';
import { USLM_ELEMENTS, INDENT_PER_LEVEL, MAX_NESTING_DEPTH } from './constants.js';
import { extractTextFromNodes, findElements } from './xml-utils.js';

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
  /** Relative path: statutes/title-{n}/chapter-{n}/section-{n}.md */
  path: string;
  /** Full markdown content including frontmatter */
  content: string;
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

  const frontmatter = FrontmatterSchema.parse({
    title: `Section ${sectionNum}${heading ? ' - ' + heading : ''}`,
    usc_title: Math.max(uscTitle, 1),
    usc_section: sectionNum,
    chapter: chapterInt,
    current_through: currentThrough || 'Unknown',
    classification: `${titleNum} U.S.C. \u00A7 ${sectionNum}`,
    generated_at: now,
  });

  const body = generateSectionBody(sectionChildren);
  const content = generateFrontmatter(frontmatter) + '\n' + body + '\n';
  const path = buildSectionPath(titleNum, chapterNum, sectionNum);

  return { path, content };
}
