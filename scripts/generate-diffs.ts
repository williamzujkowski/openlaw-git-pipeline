#!/usr/bin/env npx tsx
/**
 * Pre-compute version diffs from the us-code git repo.
 * Usage: npx tsx scripts/generate-diffs.ts --repo /path/to/us-code --output apps/web/public/diffs/
 */

import { execSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

interface SectionDiff {
  from: string;
  to: string;
  lines: { type: 'add' | 'del' | 'context'; content: string }[];
}

interface DiffManifest {
  pairs: { from: string; to: string; changedSections: number }[];
  generatedAt: string;
}

function parseTag(name: string): [number, number] {
  const m = /pl-(\d+)-(\d+)/.exec(name);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
}

function getTags(repo: string): string[] {
  return execSync('git tag', { cwd: repo, encoding: 'utf8' })
    .trim().split('\n')
    .filter((t) => t.startsWith('pl-'))
    .sort((a, b) => {
      const [ac, al] = parseTag(a);
      const [bc, bl] = parseTag(b);
      return ac !== bc ? ac - bc : al - bl;
    });
}

function getRawDiff(repo: string, from: string, to: string): string {
  try {
    return execSync(`git diff --unified=3 "${from}".."${to}" -- statutes/`, {
      cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch { return ''; }
}

function parseDiff(raw: string, from: string, to: string): Map<string, SectionDiff> {
  const result = new Map<string, SectionDiff>();
  if (!raw.trim()) return result;

  let currentPath = '';
  let currentLines: SectionDiff['lines'] = [];

  for (const line of raw.split('\n')) {
    const fileHeader = /^diff --git a\/(.+) b\/.+$/.exec(line);
    if (fileHeader) {
      if (currentPath && currentLines.length > 0) result.set(currentPath, { from, to, lines: currentLines });
      currentPath = fileHeader[1] ?? '';
      currentLines = [];
      continue;
    }
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('@@') || !currentPath) continue;
    if (line.startsWith('+')) currentLines.push({ type: 'add', content: line.slice(1) });
    else if (line.startsWith('-')) currentLines.push({ type: 'del', content: line.slice(1) });
    else currentLines.push({ type: 'context', content: line.slice(1) });
  }
  if (currentPath && currentLines.length > 0) result.set(currentPath, { from, to, lines: currentLines });
  return result;
}

function pathToOutputParts(filePath: string): { title: string; section: string } | null {
  const m = /statutes\/(title-[^/]+)\/[^/]+\/(section-[^/]+)\.md$/.exec(filePath);
  return m ? { title: m[1] ?? '', section: m[2] ?? '' } : null;
}

// --- Main ---

const { values } = parseArgs({ options: { repo: { type: 'string' }, output: { type: 'string' } } });
const { repo, output } = values;

if (!repo || !output) {
  console.error('Usage: npx tsx scripts/generate-diffs.ts --repo <path> --output <path>');
  process.exit(1);
}

const tags = getTags(repo);
console.log(`Found ${tags.length} pl-* tags: ${tags[0]} … ${tags[tags.length - 1]}`);
if (tags.length < 2) { console.error('Need at least 2 tags to generate diffs.'); process.exit(1); }

const manifest: DiffManifest = { pairs: [], generatedAt: new Date().toISOString() };

for (let i = 0; i < tags.length - 1; i++) {
  const from = tags[i] as string;
  const to = tags[i + 1] as string;
  console.log(`  Diffing ${from} → ${to}…`);

  const diffs = parseDiff(getRawDiff(repo, from, to), from, to);
  let changedSections = 0;
  const dir = join(output, `${from}_${to}`);

  for (const [filePath, diff] of diffs) {
    const parts = pathToOutputParts(filePath);
    if (!parts) continue;
    const sectionDir = join(dir, parts.title);
    await mkdir(sectionDir, { recursive: true });
    await writeFile(join(sectionDir, `${parts.section}.json`), JSON.stringify(diff, null, 2));
    changedSections++;
  }

  manifest.pairs.push({ from, to, changedSections });
  console.log(`    ${changedSections} sections changed`);
}

await mkdir(output, { recursive: true });
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Done. Manifest written to ${output}/manifest.json`);
