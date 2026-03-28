import { ok, err } from '@civic-source/types';
import type { Result, IXmlToMarkdownAdapter } from '@civic-source/types';
import { USLM_ELEMENTS } from './constants.js';
import { createLogger } from './logger.js';
import { parseUslmXml } from './parser.js';
import { extractTextFromNodes, findElements } from './xml-utils.js';
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
    if (match) return match[1];
  }
  const nums = findElements(children, USLM_ELEMENTS.num);
  if (nums.length > 0) {
    const text = extractTextFromNodes(nums[0].children).replace(/[^0-9a-zA-Z-]/g, '');
    return text || fallback;
  }
  return fallback;
}

/** Collect all section elements from a parent node's children */
function collectSections(
  children: unknown[]
): Array<{ children: unknown[]; attrs: Record<string, string> }> {
  return findElements(children, USLM_ELEMENTS.section);
}

/** Walk the parsed tree and collect chapter->section mappings */
function walkTitle(
  titleChildren: unknown[]
): Array<{ chapterNum: string; sectionChildren: unknown[]; sectionNum: string }> {
  const results: Array<{ chapterNum: string; sectionChildren: unknown[]; sectionNum: string }> = [];

  const containers = [
    USLM_ELEMENTS.chapter,
    USLM_ELEMENTS.subchapter,
    USLM_ELEMENTS.part,
    USLM_ELEMENTS.subtitle,
  ];

  // Direct sections under title (no chapter)
  for (const section of collectSections(titleChildren)) {
    const sectionNum = extractNumFromId(section.children, section.attrs, '0');
    results.push({ chapterNum: '0', sectionChildren: section.children, sectionNum });
  }

  // Walk containers for chapters
  for (const containerName of containers) {
    const containerItems = findElements(titleChildren, containerName);
    for (const container of containerItems) {
      const chapterNum = extractNumFromId(container.children, container.attrs, '0');

      // Sections directly in container
      for (const section of collectSections(container.children)) {
        const sectionNum = extractNumFromId(section.children, section.attrs, '0');
        results.push({ chapterNum, sectionChildren: section.children, sectionNum });
      }

      // Recurse one level for nested subchapter/part
      for (const innerName of containers) {
        const innerItems = findElements(container.children, innerName);
        for (const inner of innerItems) {
          for (const section of collectSections(inner.children)) {
            const sectionNum = extractNumFromId(section.children, section.attrs, '0');
            results.push({ chapterNum, sectionChildren: section.children, sectionNum });
          }
        }
      }
    }
  }

  return results;
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

    // Find the title node — may be inside lawDoc or at root
    const lawDocs = findElements(root, USLM_ELEMENTS.lawDoc);
    const titleSource = lawDocs.length > 0 ? lawDocs[0].children : root;
    const titles = findElements(titleSource, USLM_ELEMENTS.title);

    if (titles.length === 0) {
      return err(new Error('No title element found in document'));
    }

    const titleChildren = titles[0].children;
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
