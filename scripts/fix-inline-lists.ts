#!/usr/bin/env tsx
/**
 * Post-processing script to fix inline legal list markers in existing markdown files.
 * Reads each affected file, applies reformatInlineLists to the body (after frontmatter),
 * and writes back.
 *
 * Usage: npx tsx scripts/fix-inline-lists.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reformatInlineLists } from '../packages/transformer/src/markdown-generator.js';

const STATUTES_DIR = resolve(
  import.meta.dirname ?? '.',
  '../apps/web/content-data/statutes'
);

/** Split a markdown file into frontmatter and body */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
  if (fmEnd === -1) {
    return { frontmatter: '', body: content };
  }
  const cutPoint = fmEnd + 3;
  return {
    frontmatter: content.slice(0, cutPoint),
    body: content.slice(cutPoint),
  };
}

/** Check if a body has inline markers that need reformatting */
function needsReformat(body: string): boolean {
  const lines = body.split('\n');
  for (const line of lines) {
    // Skip already-formatted lines, headings, and empty lines
    if (/^\s*- \*\*/.test(line) || line.startsWith('#') || line.trim() === '') {
      continue;
    }
    // Check for at least 2 inline markers on one line
    const markerPattern = /(\([a-z]\)|\(\d{1,2}\)|\([A-Z]\)|\([ivxlcdm]+\))\s/g;
    const matches = [...line.matchAll(markerPattern)];
    if (matches.length >= 2) return true;
    // Also check start-of-line marker + inline marker
    if (/^(\([a-z]\)|\(\d{1,2}\)|\([A-Z]\)|\([ivxlcdm]+\))\s/.test(line) && matches.length >= 1) {
      return true;
    }
  }
  return false;
}

// Collect all .md files under statutes dir that need fixing
import { execSync } from 'node:child_process';

const affectedFiles = execSync(
  `cd "${STATUTES_DIR}" && { grep -rPl '^\\(a\\) .*\\(b\\) ' --include="*.md"; grep -rPl '^[^-#\\s].*\\(a\\) [A-Z].*\\(b\\) [A-Z]' --include="*.md"; } | sort -u`,
  { encoding: 'utf-8' }
).trim().split('\n').filter(Boolean);

console.log(`Found ${affectedFiles.length} potentially affected files`);

let fixed = 0;
let skipped = 0;

for (const relPath of affectedFiles) {
  const filePath = resolve(STATUTES_DIR, relPath);
  const content = readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = splitFrontmatter(content);

  if (!needsReformat(body)) {
    skipped++;
    continue;
  }

  const reformattedBody = reformatInlineLists(body);
  if (reformattedBody === body) {
    skipped++;
    continue;
  }

  writeFileSync(filePath, frontmatter + reformattedBody, 'utf-8');
  fixed++;
  console.log(`Fixed: ${relPath}`);
}

console.log(`\nDone: ${fixed} files fixed, ${skipped} skipped`);
