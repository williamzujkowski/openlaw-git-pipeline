#!/usr/bin/env npx tsx
/**
 * Import historical OLRC release points as git commits (delta-only).
 *
 * Usage:
 *   npx tsx scripts/import-history.ts --repo /path/to/us-code
 *   npx tsx scripts/import-history.ts --repo /path/to/us-code --start pl/119/1 --end pl/119/73
 *   npx tsx scripts/import-history.ts --repo /path/to/us-code --title 18 --dry-run
 *   npx tsx scripts/import-history.ts --repo /path/to/us-code --resume
 *
 * Requires: packages to be built first (`pnpm build`).
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { createLogger, TokenBucket } from '../packages/shared/src/index.js';
import { XmlToMarkdownAdapter } from '../packages/transformer/src/index.js';
import type { MarkdownFile } from '../packages/transformer/src/index.js';

import { buildManifest, detectDelta } from './lib/delta-detector.js';
import {
  scrapeReleasePoints,
  filterRange,
  parseReleasePointStr,
  type ReleasePointId,
} from './lib/release-points.js';
import {
  loadState,
  saveState,
  gitCommit,
  gitTag,
  downloadAndExtractXml,
  type ImportState,
} from './lib/import-helpers.js';

const log = createLogger('import-history');

// --- Constants ---

const ALL_TITLES = Array.from({ length: 54 }, (_, i) => (i + 1).toString().padStart(2, '0'));
const MAX_CONCURRENT = 5;
const INTER_TITLE_DELAY_MS = 1000;

// --- Argument parsing ---

const { values: args } = parseArgs({
  options: {
    repo: { type: 'string', short: 'r' },
    start: { type: 'string' },
    end: { type: 'string' },
    title: { type: 'string', short: 't' },
    'dry-run': { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help || !args.repo) {
  const msg = `
Usage: npx tsx scripts/import-history.ts --repo <path> [options]

Options:
  --repo, -r     Path to the us-code git repository (required)
  --start        Start release point, e.g. pl/119/1 (inclusive)
  --end          End release point, e.g. pl/119/73 (inclusive)
  --title, -t    Process only this title number (e.g. 18)
  --dry-run      Show what would change without committing
  --resume       Resume from last completed release point
  --help, -h     Show this help message
`;
  process.stdout.write(msg + '\n');
  process.exit(args.help ? 0 : 1);
}

const repoPath = args.repo;
const dryRun = args['dry-run'] ?? false;
const titleFilter = args.title?.padStart(2, '0');
const titlesToProcess = titleFilter ? [titleFilter] : ALL_TITLES;

// --- Core import logic ---

interface ImportMetrics {
  releasePointsProcessed: number;
  titlesChanged: number;
  sectionsChanged: number;
  startTime: number;
}

async function processBatch(
  batch: string[],
  rp: ReleasePointId,
  state: ImportState,
  rateLimiter: TokenBucket
): Promise<{ titlesChanged: number; sectionsChanged: number }> {
  let titlesChanged = 0;
  let sectionsChanged = 0;

  const results = await Promise.all(
    batch.map(async (paddedTitle) => {
      const xml = await downloadAndExtractXml(rp, paddedTitle, rateLimiter, log);
      if (!xml) return { paddedTitle, files: [] as MarkdownFile[] };

      const transformer = new XmlToMarkdownAdapter(rp.label);
      const result = transformer.transformToFiles(xml);
      if (!result.ok) {
        log.warn('Transform failed', { title: paddedTitle, error: result.error.message });
        return { paddedTitle, files: [] as MarkdownFile[] };
      }
      return { paddedTitle, files: result.value };
    })
  );

  for (const { paddedTitle, files } of results) {
    if (files.length === 0) continue;

    const currentManifest = buildManifest(files);
    const previousRaw = state.manifests[paddedTitle];
    const previousManifest = new Map<string, string>(
      previousRaw ? Object.entries(previousRaw) : []
    );
    const delta = detectDelta(previousManifest, currentManifest);

    if (delta.changed.length === 0 && delta.deleted.length === 0) continue;

    titlesChanged++;
    sectionsChanged += delta.changed.length;

    if (!dryRun) {
      for (const file of files) {
        if (!delta.changed.includes(file.path)) continue;
        const fullPath = join(repoPath, file.path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, file.content, 'utf-8');
      }
      for (const path of delta.deleted) {
        await rm(join(repoPath, path), { force: true });
      }
    }

    // Update manifest in state
    const manifestObj: Record<string, string> = {};
    for (const [k, v] of currentManifest) {
      manifestObj[k] = v;
    }
    state.manifests[paddedTitle] = manifestObj;

    log.info('Title delta', {
      title: parseInt(paddedTitle, 10),
      changed: delta.changed.length,
      deleted: delta.deleted.length,
      unchanged: delta.unchanged.length,
      dryRun,
    });
  }

  return { titlesChanged, sectionsChanged };
}

async function processReleasePoint(
  rp: ReleasePointId,
  state: ImportState,
  rateLimiter: TokenBucket,
  metrics: ImportMetrics
): Promise<void> {
  log.info('Processing release point', { label: rp.label });
  let totalChanged = 0;
  let totalTitlesChanged = 0;

  for (let i = 0; i < titlesToProcess.length; i += MAX_CONCURRENT) {
    const batch = titlesToProcess.slice(i, i + MAX_CONCURRENT);
    const result = await processBatch(batch, rp, state, rateLimiter);
    totalChanged += result.sectionsChanged;
    totalTitlesChanged += result.titlesChanged;

    if (i + MAX_CONCURRENT < titlesToProcess.length) {
      await new Promise<void>((r) => setTimeout(r, INTER_TITLE_DELAY_MS));
    }
  }

  if (totalChanged > 0 || totalTitlesChanged > 0) {
    const commitMsg = `chore(law): Update to ${rp.label}`;
    const tag = `pl-${rp.congress}-${rp.law}`;
    if (dryRun) {
      log.info('Dry run: would commit', { message: commitMsg, tag });
    } else {
      await gitCommit(repoPath, commitMsg);
      await gitTag(repoPath, tag);
      log.info('Committed', { message: commitMsg, tag });
    }
  } else {
    log.info('No changes for release point', { label: rp.label });
  }

  state.lastCompletedReleasePoint = `${rp.congress}-${rp.law}`;
  if (!dryRun) {
    await saveState(repoPath, state);
  }

  metrics.releasePointsProcessed++;
  metrics.titlesChanged += totalTitlesChanged;
  metrics.sectionsChanged += totalChanged;
}

// --- Main ---

async function main(): Promise<void> {
  const metrics: ImportMetrics = {
    releasePointsProcessed: 0,
    titlesChanged: 0,
    sectionsChanged: 0,
    startTime: performance.now(),
  };

  const rateLimiter = new TokenBucket({
    capacity: MAX_CONCURRENT,
    refillRate: 1,
    refillIntervalMs: INTER_TITLE_DELAY_MS,
  });

  log.info('Scraping OLRC release points index');
  const allPoints = await scrapeReleasePoints();
  log.info('Found release points', { count: allPoints.length });

  const startRp = args.start ? parseReleasePointStr(args.start) : undefined;
  const endRp = args.end ? parseReleasePointStr(args.end) : undefined;

  if (args.start && !startRp) {
    log.error('Invalid --start format, expected pl/{congress}/{law}', { value: args.start });
    process.exit(1);
  }
  if (args.end && !endRp) {
    log.error('Invalid --end format, expected pl/{congress}/{law}', { value: args.end });
    process.exit(1);
  }

  let points = filterRange(allPoints, startRp ?? undefined, endRp ?? undefined);
  const state = await loadState(repoPath);

  if (args.resume && state.lastCompletedReleasePoint) {
    const lastRp = parseReleasePointStr(`pl/${state.lastCompletedReleasePoint.replace('-', '/')}`);
    if (lastRp) {
      const before = points.length;
      points = points.filter(
        (p) => p.congress > lastRp.congress ||
          (p.congress === lastRp.congress && p.law > lastRp.law)
      );
      log.info('Resuming after', {
        lastCompleted: state.lastCompletedReleasePoint,
        skipped: before - points.length,
      });
    }
  }

  log.info('Processing release points', {
    total: points.length,
    dryRun,
    titleFilter: titleFilter ? parseInt(titleFilter, 10) : 'all',
  });

  for (const rp of points) {
    try {
      await processReleasePoint(rp, state, rateLimiter, metrics);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Release point failed, continuing to next', { label: rp.label, error: msg });
      // Save state so we don't retry this one
      state.lastCompletedReleasePoint = `${rp.congress}-${rp.law}`;
      if (!dryRun) await saveState(repoPath, state);
    }
  }

  const elapsed = (performance.now() - metrics.startTime) / 1000;
  log.info('Import complete', {
    releasePointsProcessed: metrics.releasePointsProcessed,
    titlesChanged: metrics.titlesChanged,
    sectionsChanged: metrics.sectionsChanged,
    elapsedSeconds: Math.round(elapsed),
    dryRun,
  });
}

main().catch((error: unknown) => {
  log.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
