import { XMLParser } from 'fast-xml-parser';
import { ok, err } from '@civic-source/types';
import type { Result } from '@civic-source/types';
import { USLM_ELEMENTS } from './constants.js';
import { createLogger } from '@civic-source/shared';
import { extractTextFromNodes, findElements } from './xml-utils.js';

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
/** Find the document root element — either lawDoc (USLM 2.0) or uscDoc (USLM 1.0) */
function findDocRoot(root: unknown[]): { children: unknown[]; attrs: Record<string, string> } | undefined {
  return findElements(root, USLM_ELEMENTS.lawDoc)[0]
    ?? findElements(root, USLM_ELEMENTS.uscDoc)[0];
}

function findTitleNumber(root: unknown[]): string | undefined {
  const docRoot = findDocRoot(root);
  if (!docRoot) return undefined;

  // USLM 1.0 wraps content in <main>; USLM 2.0 has <title> directly under root
  const mainEl = findElements(docRoot.children, USLM_ELEMENTS.main)[0];
  const searchChildren = mainEl ? mainEl.children : docRoot.children;

  const firstTitle = findElements(searchChildren, USLM_ELEMENTS.title)[0];
  if (!firstTitle) return undefined;

  const titleAttrs = firstTitle.attrs;
  const identifier = titleAttrs['@_identifier'];
  if (identifier) {
    const match = /\/t(\d+)$/.exec(identifier);
    if (match?.[1]) return match[1];
  }

  // Fallback: look for num element
  const firstNum = findElements(firstTitle.children, USLM_ELEMENTS.num)[0];
  if (firstNum) {
    const text = extractTextFromNodes(firstNum.children);
    const numMatch = /\d+/.exec(text);
    return numMatch?.[0];
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

    // Validate that we have a recognizable structure (lawDoc for USLM 2.0, uscDoc for USLM 1.0)
    const hasLawDoc = findElements(root, USLM_ELEMENTS.lawDoc).length > 0;
    const hasUscDoc = findElements(root, USLM_ELEMENTS.uscDoc).length > 0;
    const hasTitle = findElements(root, USLM_ELEMENTS.title).length > 0;
    if (!hasLawDoc && !hasUscDoc && !hasTitle) {
      return err(new Error(
        `Parsed XML missing expected root elements (${USLM_ELEMENTS.lawDoc}, ${USLM_ELEMENTS.uscDoc}, or ${USLM_ELEMENTS.title})`
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
