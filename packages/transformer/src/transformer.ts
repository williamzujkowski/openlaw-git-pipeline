import { ok, err } from '@civic-source/types';
import type { Result, IXmlToMarkdownAdapter } from '@civic-source/types';
import { USLM_ELEMENTS } from './constants.js';
import { createLogger } from '@civic-source/shared';
import { parseUslmXml } from './parser.js';
import { extractTextFromNodes, findElements, getElementName } from './xml-utils.js';
import { generateMarkdownForSection } from './markdown-generator.js';
import type { MarkdownFile } from './markdown-generator.js';

const log = createLogger('transformer');

/** Extract a number string from a USLM identifier attribute or num child */
function extractNumFromId(
  children: unknown[],
  attrs: Record<string, string>,
  fallback: string
): string {
  const id = attrs['@_identifier'];
  if (id) {
    const match = /(\d+[\w-]*)$/.exec(id);
    if (match?.[1]) return match[1];
  }
  const firstNum = findElements(children, USLM_ELEMENTS.num)[0];
  if (firstNum) {
    const text = extractTextFromNodes(firstNum.children).replace(/[^0-9a-zA-Z-]/g, '');
    return text || fallback;
  }
  return fallback;
}

/** Container element names that may wrap sections at any depth */
const CONTAINER_TAGS: ReadonlySet<string> = new Set([
  USLM_ELEMENTS.subtitle,
  USLM_ELEMENTS.part,
  USLM_ELEMENTS.subpart,
  USLM_ELEMENTS.chapter,
  USLM_ELEMENTS.subchapter,
  USLM_ELEMENTS.division,
]);

/**
 * Recursively walk the tree to find all <section> elements at any depth.
 * Tracks the nearest <chapter> ancestor to assign chapter context.
 */
function findAllSections(
  nodes: unknown[],
  currentChapter: string
): Array<{ chapterNum: string; sectionChildren: unknown[]; sectionNum: string }> {
  const results: Array<{ chapterNum: string; sectionChildren: unknown[]; sectionNum: string }> = [];

  for (const node of nodes) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) continue;
    const obj = node as Record<string, unknown>;
    const tag = getElementName(node);
    if (tag === null) continue;

    if (tag === USLM_ELEMENTS.section) {
      const children = obj[tag] as unknown[];
      const attrs = getAttrsFromNode(obj);
      const sectionNum = extractNumFromId(children, attrs, '0');
      results.push({ chapterNum: currentChapter, sectionChildren: children, sectionNum });
    } else if (CONTAINER_TAGS.has(tag)) {
      const children = obj[tag] as unknown[];
      const attrs = getAttrsFromNode(obj);
      // Update chapter context when we enter a chapter element
      const chapterForDescendants = tag === USLM_ELEMENTS.chapter
        ? extractNumFromId(children, attrs, currentChapter)
        : currentChapter;
      results.push(...findAllSections(children, chapterForDescendants));
    }
  }

  return results;
}

/** Extract :@ attributes from a preserveOrder node */
function getAttrsFromNode(obj: Record<string, unknown>): Record<string, string> {
  if (':@' in obj && obj[':@'] !== null && typeof obj[':@'] === 'object') {
    const raw = obj[':@'] as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = String(v);
    }
    return result;
  }
  return {};
}

/** Walk the parsed tree and collect chapter->section mappings */
function walkTitle(
  titleChildren: unknown[]
): Array<{ chapterNum: string; sectionChildren: unknown[]; sectionNum: string }> {
  return findAllSections(titleChildren, '0');
}

/** XML-to-Markdown transformer implementing IXmlToMarkdownAdapter */
export class XmlToMarkdownAdapter implements IXmlToMarkdownAdapter {
  private readonly currentThrough: string;

  constructor(currentThrough = 'Unknown') {
    this.currentThrough = currentThrough;
  }

  /** Transform a USLM XML string into a single combined markdown string */
  transform(xml: string): Result<string> {
    const result = this.transformToFiles(xml);
    if (!result.ok) return result;

    const combined = result.value.map((f) => f.content).join('\n---\n\n');
    return ok(combined);
  }

  /** Transform XML into individual MarkdownFile objects (one per section) */
  transformToFiles(xml: string): Result<MarkdownFile[]> {
    const timer = log.startTimer('Full transformation');

    const parseResult = parseUslmXml(xml);
    if (!parseResult.ok) return parseResult;

    const { root, titleNumber } = parseResult.value;
    const titleNum = titleNumber ?? '0';

    // Find the title node — may be inside lawDoc (USLM 2.0) or uscDoc (USLM 1.0)
    const docRoot = findElements(root, USLM_ELEMENTS.lawDoc)[0]
      ?? findElements(root, USLM_ELEMENTS.uscDoc)[0];
    const docChildren = docRoot ? docRoot.children : root;

    // USLM 1.0 wraps content in <main>; USLM 2.0 has <title> directly under root
    const mainEl = findElements(docChildren, USLM_ELEMENTS.main)[0];
    const titleSource = mainEl ? mainEl.children : docChildren;
    const firstTitle = findElements(titleSource, USLM_ELEMENTS.title)[0];

    if (!firstTitle) {
      return err(new Error('No title element found in document'));
    }

    const titleChildren = firstTitle.children;
    const entries = walkTitle(titleChildren);
    const files: MarkdownFile[] = [];
    let processed = 0;
    let skipped = 0;

    for (const { chapterNum, sectionChildren, sectionNum } of entries) {
      try {
        const file = generateMarkdownForSection(
          sectionChildren,
          titleNum,
          chapterNum,
          sectionNum,
          this.currentThrough
        );
        files.push(file);
        processed++;
      } catch (error: unknown) {
        skipped++;
        const message = error instanceof Error ? error.message : String(error);
        log.warn('Skipping malformed section', { sectionNum, chapterNum, error: message });
      }
    }

    timer();
    log.info('Transformation complete', { processed, skipped, totalFiles: files.length });
    log.logMemory();

    return ok(files);
  }
}
