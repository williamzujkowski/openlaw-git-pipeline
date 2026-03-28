/**
 * Utilities for walking fast-xml-parser preserveOrder output.
 *
 * With preserveOrder: true, the parser returns arrays of single-key objects:
 *   [{ tag: [...children] }, { "#text": "..." }, { tag2: [...] }]
 * Attributes live in a ":@" sibling key on the same object.
 */

/** A text node in preserveOrder output */
export interface PreserveOrderTextNode {
  '#text': string;
}

/** An element node in preserveOrder output */
export interface PreserveOrderElementNode {
  [tag: string]: unknown[];
}

/** A single node in the preserveOrder output */
export type PreserveOrderNode = PreserveOrderTextNode | PreserveOrderElementNode;

/**
 * Recursively walk nodes and concatenate all #text values in document order.
 * Joins segments with a single space and collapses whitespace.
 */
export function extractTextFromNodes(nodes: unknown[]): string {
  const segments: string[] = [];
  for (const node of nodes) {
    if (!isObject(node)) continue;
    const obj = node as Record<string, unknown>;
    if ('#text' in obj) {
      segments.push(String(obj['#text']));
    } else {
      for (const [key, val] of Object.entries(obj)) {
        if (key === ':@') continue;
        if (Array.isArray(val)) {
          segments.push(extractTextFromNodes(val));
        }
      }
    }
  }
  return segments
    .filter((s) => s.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find all child elements with a given tag name.
 * Returns the child arrays (the value of the tag key) wrapped with their attributes.
 */
export function findElements(
  nodes: unknown[],
  tagName: string
): Array<{ children: unknown[]; attrs: Record<string, string> }> {
  const results: Array<{ children: unknown[]; attrs: Record<string, string> }> = [];
  for (const node of nodes) {
    if (!isObject(node)) continue;
    const obj = node as Record<string, unknown>;
    if (tagName in obj && Array.isArray(obj[tagName])) {
      const attrs = getAttributes(node);
      results.push({ children: obj[tagName] as unknown[], attrs });
    }
  }
  return results;
}

/**
 * Extract ":@" attributes from a preserveOrder node.
 * Returns an empty record if none present.
 */
export function getAttributes(node: unknown): Record<string, string> {
  if (!isObject(node)) return {};
  const obj = node as Record<string, unknown>;
  if (':@' in obj && isObject(obj[':@'])) {
    const raw = obj[':@'] as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = String(v);
    }
    return result;
  }
  return {};
}

/**
 * Get the element tag name of a node (the first key that is not ":@" or "#text").
 * Returns null for text nodes or unrecognized shapes.
 */
export function getElementName(node: unknown): string | null {
  if (!isObject(node)) return null;
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== ':@' && key !== '#text') return key;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
