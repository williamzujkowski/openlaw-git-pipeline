import { XMLParser } from 'fast-xml-parser';
import { ok, err } from '@civic-source/types';
import type { Result } from '@civic-source/types';
import { USLM_ELEMENTS } from './constants.js';
import { createLogger } from './logger.js';
import { extractTextFromNodes, findElements, getAttributes } from './xml-utils.js';

const log = createLogger('parser');

/** Parsed USLM document structure (preserveOrder format) */
export interface ParsedDocument {
  /** Root parsed array from fast-xml-parser (preserveOrder: true) */
  root: unknown[];
  /** Title number extracted from the document */
  titleNumber: string | undefined;
}

/** Maximum entity count to prevent XXE attacks */
const MAX_ENTITY_COUNT = 128;

/** Create a configured XMLParser instance for USLM documents */
function createUslmParser(): XMLParser {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    preserveOrder: true,
    processEntities: {
      maxEntityCount: MAX_ENTITY_COUNT,
    },
  });
  return parser;
}

/**
 * Extract text from a preserveOrder node array or a plain value.
 * For backward compatibility with markdown-generator and transformer.
 */
export function extractText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return extractTextFromNodes(node);
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if ('#text' in obj && typeof obj['#text'] === 'string') return obj['#text'];
    if ('#text' in obj && typeof obj['#text'] === 'number') return String(obj['#text']);
  }
  return '';
}

/**
 * Find the title number from a parsed USLM document (preserveOrder format).
 * Looks for the identifier attribute on the title element.
 */
function findTitleNumber(root: unknown[]): string | undefined {
  const lawDocs = findElements(root, USLM_ELEMENTS.lawDoc);
  if (lawDocs.length === 0) return undefined;

  const titles = findElements(lawDocs[0].children, USLM_ELEMENTS.title);
  if (titles.length === 0) return undefined;

  const titleAttrs = titles[0].attrs;
  const identifier = titleAttrs['@_identifier'];
  if (identifier) {
    const match = /\/t(\d+)$/.exec(identifier);
    if (match) return match[1];
  }

  // Fallback: look for num element
  const nums = findElements(titles[0].children, USLM_ELEMENTS.num);
  if (nums.length > 0) {
    const text = extractTextFromNodes(nums[0].children);
    const numMatch = /\d+/.exec(text);
    return numMatch ? numMatch[0] : undefined;
  }

  return undefined;
}

/** Parse a USLM XML string into a structured document */
export function parseUslmXml(xml: string): Result<ParsedDocument> {
  const timer = log.startTimer('XML parsing');
  try {
    const parser = createUslmParser();
    const parsed: unknown = parser.parse(xml);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return err(new Error('XML parsing returned empty result'));
    }

    const root = parsed as unknown[];

    // Validate that we have a recognizable structure
    const hasLawDoc = findElements(root, USLM_ELEMENTS.lawDoc).length > 0;
    const hasTitle = findElements(root, USLM_ELEMENTS.title).length > 0;
    if (!hasLawDoc && !hasTitle) {
      return err(new Error(
        `Parsed XML missing expected root elements (${USLM_ELEMENTS.lawDoc} or ${USLM_ELEMENTS.title})`
      ));
    }

    const titleNumber = findTitleNumber(root);
    timer();
    return ok({ root, titleNumber });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new Error(`XML parsing failed: ${message}`));
  }
}
