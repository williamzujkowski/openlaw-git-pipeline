#!/usr/bin/env npx tsx
/**
 * Pre-compute version diffs from the us-code git repo.
 * Only generates diffs for sections with meaningful BODY changes
 * (excludes frontmatter-only changes like current_through, generated_at).
 *
 * Supports incremental mode: skips pairs already in existing manifest.
 *
 * Usage:
 *   npx tsx scripts/generate-diffs.ts --repo /path/to/us-code --output apps/web/public/diffs/
 *   npx tsx scripts/generate-diffs.ts --repo /path/to/us-code --output apps/web/public/diffs/ --full
 */

import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

interface DiffLine {
  type: 'add' | 'del' | 'context';
  content: string;
}

interface SectionDiff {
  from: string;
  to: string;
  lines: DiffLine[];
}

interface DiffManifest {
  pairs: { from: string; to: string; changedSections: number }[];
  generatedAt: string;
}

/** Frontmatter fields that change on every regeneration — not meaningful diffs */
const FRONTMATTER_NOISE = ['current_through', 'generated_at', 'classification'];

function parseTag(name: string): [number, number] {
  const m = /pl-(\d+)-(\d+)/.exec(name);
  return m && m[1] && m[2] ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
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
  } catch (e) {
    console.warn(`  Warning: git diff failed for ${from}..${to}: ${e instanceof Error ? e.message : 'unknown'}`);
    return '';
  }
}

/** Check if a diff line is a frontmatter noise change */
function isFrontmatterNoise(content: string): boolean {
  return FRONTMATTER_NOISE.some((field) => content.trimStart().startsWith(`${field}:`));
}

/** Check if a diff has meaningful body changes (not just frontmatter) */
function hasMeaningfulChanges(lines: DiffLine[]): boolean {
  return lines.some(
    (line) => (line.type === 'add' || line.type === 'del') && !isFrontmatterNoise(line.content)
  );
}

/** Filter diff to only body-relevant lines (strip frontmatter noise) */
function filterToBodyChanges(lines: DiffLine[]): DiffLine[] {
  return lines.filter(
    (line) => line.type === 'context' || !isFrontmatterNoise(line.content)
  );
}

function parseDiff(raw: string, from: string, to: string): Map<string, SectionDiff> {
  const result = new Map<string, SectionDiff>();
  if (!raw.trim()) return result;

  let currentPath = '';
  let currentLines: DiffLine[] = [];

  for (const line of raw.split('\n')) {
    const fileHeader = /^diff --git a\/(.+) b\/.+$/.exec(line);
    if (fileHeader) {
      if (currentPath && currentLines.length > 0) {
        if (hasMeaningfulChanges(currentLines)) {
          result.set(currentPath, { from, to, lines: filterToBodyChanges(currentLines) });
        }
      }
      currentPath = fileHeader[1] ?? '';
      currentLines = [];
      continue;
    }
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('@@') || !currentPath) continue;
    if (line.startsWith('+')) currentLines.push({ type: 'add', content: line.slice(1) });
    else if (line.startsWith('-')) currentLines.push({ type: 'del', content: line.slice(1) });
    else currentLines.push({ type: 'context', content: line.slice(1) });
  }
  if (currentPath && currentLines.length > 0 && hasMeaningfulChanges(currentLines)) {
    result.set(currentPath, { from, to, lines: filterToBodyChanges(currentLines) });
  }
  return result;
}

function pathToOutputParts(filePath: string): { title: string; section: string } | null {
  const m = /statutes\/(title-[^/]+)\/[^/]+\/(section-[^/]+)\.md$/.exec(filePath);
  return m ? { title: m[1] ?? '', section: m[2] ?? '' } : null;
}

/** Load existing manifest for incremental mode */
async function loadExistingManifest(outputDir: string): Promise<DiffManifest | null> {
  try {
    const raw = await readFile(join(outputDir, 'manifest.json'), 'utf8');
    return JSON.parse(raw) as DiffManifest;
  } catch {
    return null;
  }
}

// --- Main ---

const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    output: { type: 'string' },
    full: { type: 'boolean', default: false },
  },
});
const { repo, output, full } = values;

if (!repo || !output) {
  console.error('Usage: npx tsx scripts/generate-diffs.ts --repo <path> --output <path> [--full]');
  process.exit(1);
}

const tags = getTags(repo);
console.log(`Found ${tags.length} pl-* tags: ${tags[0]} \u2026 ${tags[tags.length - 1]}`);
if (tags.length < 2) { console.error('Need at least 2 tags to generate diffs.'); process.exit(1); }

// Load existing manifest for incremental mode
const existingManifest = full ? null : await loadExistingManifest(output);
const existingPairs = new Set(
  existingManifest?.pairs.map(p => `${p.from}_${p.to}`) ?? []
);

const manifest: DiffManifest = {
  pairs: existingManifest?.pairs ?? [],
  generatedAt: new Date().toISOString(),
};

let skipped = 0;
let computed = 0;

for (let i = 0; i < tags.length - 1; i++) {
  const from = tags[i] as string;
  const to = tags[i + 1] as string;
  const key = `${from}_${to}`;

  // Incremental: skip already-computed pairs
  if (existingPairs.has(key)) {
    skipped++;
    continue;
  }

  console.log(`  Diffing ${from} \u2192 ${to}\u2026`);

  const diffs = parseDiff(getRawDiff(repo, from, to), from, to);
  let changedSections = 0;
  const dir = join(output, key);

  for (const [filePath, diff] of diffs) {
    const parts = pathToOutputParts(filePath);
    if (!parts) continue;
    const sectionDir = join(dir, parts.title);
    await mkdir(sectionDir, { recursive: true });
    await writeFile(join(sectionDir, `${parts.section}.json`), JSON.stringify(diff));
    changedSections++;
  }

  manifest.pairs.push({ from, to, changedSections });
  computed++;
  console.log(`    ${changedSections} sections with body changes (excluded frontmatter-only)`);
}

// Re-sort manifest pairs by tag order
manifest.pairs.sort((a, b) => {
  const [ac, al] = parseTag(a.from);
  const [bc, bl] = parseTag(b.from);
  return ac !== bc ? ac - bc : al - bl;
});

await mkdir(output, { recursive: true });
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Done. ${computed} new pairs computed, ${skipped} skipped (already cached). Manifest: ${output}/manifest.json`);
