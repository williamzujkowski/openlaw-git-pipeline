import { XMLParser } from 'fast-xml-parser';
import { ok, err } from '@openlaw-git/types';
import type { Result } from '@openlaw-git/types';
import { USLM_ELEMENTS } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('parser');

/** Parsed USLM document structure */
export interface ParsedDocument {
  /** Root parsed object from fast-xml-parser */
  root: Record<string, unknown>;
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
    commentPropName: false,
    cdataPropName: false,
    processEntities: {
      maxEntityCount: MAX_ENTITY_COUNT,
    },
  });
  return parser;
}

/**
 * Extract text from a node that may be a string or an object with #text.
 * Returns empty string if not found.
 */
export function extractText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if ('#text' in obj && typeof obj['#text'] === 'string') return obj['#text'];
    if ('#text' in obj && typeof obj['#text'] === 'number') return String(obj['#text']);
  }
  return '';
}

/**
 * Find the title number from a parsed USLM document.
 * Looks for the identifier attribute on the title element.
 */
function findTitleNumber(root: Record<string, unknown>): string | undefined {
  const lawDoc = root[USLM_ELEMENTS.lawDoc] as Record<string, unknown> | undefined;
  if (!lawDoc) return undefined;

  const title = lawDoc[USLM_ELEMENTS.title] as Record<string, unknown> | undefined;
  if (!title) return undefined;

  const identifier = title['@_identifier'] as string | undefined;
  if (identifier) {
    // Pattern: /us/usc/t{num} → extract num
    const match = /\/t(\d+)$/.exec(identifier);
    if (match) return match[1];
  }

  // Fallback: look for num element
  const num = title[USLM_ELEMENTS.num] as unknown;
  const text = extractText(num);
  const numMatch = /\d+/.exec(text);
  return numMatch ? numMatch[0] : undefined;
}

/** Parse a USLM XML string into a structured document */
export function parseUslmXml(xml: string): Result<ParsedDocument> {
  const timer = log.startTimer('XML parsing');
  try {
    const parser = createUslmParser();
    const parsed: unknown = parser.parse(xml);

    if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
      return err(new Error('XML parsing returned empty result'));
    }

    const root = parsed as Record<string, unknown>;

    // Validate that we have a recognizable structure
    const hasLawDoc = USLM_ELEMENTS.lawDoc in root;
    const hasTitle = USLM_ELEMENTS.title in root;
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
