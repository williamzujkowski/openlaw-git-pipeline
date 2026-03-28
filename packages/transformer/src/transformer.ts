import { ok, err } from '@civic-source/types';
import type { Result, IXmlToMarkdownAdapter } from '@civic-source/types';
import { USLM_ELEMENTS } from './constants.js';
import { createLogger } from './logger.js';
import { parseUslmXml, extractText } from './parser.js';
import { generateMarkdownForSection } from './markdown-generator.js';
import type { MarkdownFile } from './markdown-generator.js';

const log = createLogger('transformer');

/** Extract a number string from a USLM identifier attribute */
function extractNumFromId(node: Record<string, unknown>, fallback: string): string {
  const id = node['@_identifier'] as string | undefined;
  if (id) {
    const match = /(\d+[\w-]*)$/.exec(id);
    if (match) return match[1];
  }
  const numEl = node[USLM_ELEMENTS.num] as unknown;
  const text = extractText(numEl).replace(/[^0-9a-zA-Z-]/g, '');
  return text || fallback;
}

/** Collect all sections from within a chapter node */
function collectSections(node: Record<string, unknown>): Record<string, unknown>[] {
  const sections: Record<string, unknown>[] = [];
  const sectionData = node[USLM_ELEMENTS.section];
  if (!sectionData) return sections;

  const items = Array.isArray(sectionData) ? sectionData : [sectionData];
  for (const item of items) {
    if (typeof item === 'object' && item !== null) {
      sections.push(item as Record<string, unknown>);
    }
  }
  return sections;
}

/** Walk the parsed tree and collect chapter→section mappings */
function walkTitle(
  titleNode: Record<string, unknown>
): Array<{ chapterNum: string; section: Record<string, unknown>; sectionNum: string }> {
  const results: Array<{ chapterNum: string; section: Record<string, unknown>; sectionNum: string }> = [];

  // Chapters may be nested under subtitle, subchapter, part, etc.
  const containers = [
    USLM_ELEMENTS.chapter,
    USLM_ELEMENTS.subchapter,
    USLM_ELEMENTS.part,
    USLM_ELEMENTS.subtitle,
  ];

  // Direct sections under title (no chapter)
  for (const section of collectSections(titleNode)) {
    const sectionNum = extractNumFromId(section, '0');
    results.push({ chapterNum: '0', section, sectionNum });
  }

  // Walk containers for chapters
  for (const containerName of containers) {
    const containerData = titleNode[containerName];
    if (!containerData) continue;

    const items = Array.isArray(containerData) ? containerData : [containerData];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const container = item as Record<string, unknown>;
      const chapterNum = extractNumFromId(container, '0');

      // Sections directly in container
      for (const section of collectSections(container)) {
        const sectionNum = extractNumFromId(section, '0');
        results.push({ chapterNum, section, sectionNum });
      }

      // Recurse one level for nested subchapter/part
      for (const innerName of containers) {
        const innerData = container[innerName];
        if (!innerData) continue;
        const innerItems = Array.isArray(innerData) ? innerData : [innerData];
        for (const inner of innerItems) {
          if (typeof inner !== 'object' || inner === null) continue;
          const innerNode = inner as Record<string, unknown>;
          for (const section of collectSections(innerNode)) {
            const sectionNum = extractNumFromId(section, '0');
            results.push({ chapterNum, section, sectionNum });
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

    // Find the title node
    const lawDoc = root[USLM_ELEMENTS.lawDoc] as Record<string, unknown> | undefined;
    const titleNode = (lawDoc?.[USLM_ELEMENTS.title] ?? root[USLM_ELEMENTS.title]) as
      Record<string, unknown> | undefined;

    if (!titleNode) {
      return err(new Error('No title element found in document'));
    }

    const entries = walkTitle(titleNode);
    const files: MarkdownFile[] = [];
    let processed = 0;
    let skipped = 0;

    for (const { chapterNum, section, sectionNum } of entries) {
      try {
        const file = generateMarkdownForSection(
          section,
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
