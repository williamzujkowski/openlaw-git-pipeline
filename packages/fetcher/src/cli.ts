#!/usr/bin/env node
/**
 * openlaw-fetch CLI — download and inspect OLRC US Code release points.
 *
 * Commands:
 *   list                         List current release point titles
 *   history                      List all historical release points chronologically
 *   download --title <N>         Download XML for a specific title
 *   download --all               Download all titles for current release
 */

import { OlrcFetcher } from './fetcher.js';
import { createLogger } from '@civic-source/shared';
import type { ReleasePoint } from '@civic-source/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: openlaw-fetch <command> [options]',
      '',
      'Commands:',
      '  list                       List current release point titles',
      '  history                    List all historical release points chronologically',
      '  download --title <N>       Download XML for title N',
      '  download --all             Download all titles for current release',
      '',
      'Options:',
      '  --title <N>  Title number (e.g. 26)',
      '  --all        Download all titles',
      '  --help       Show this help',
      '',
    ].join('\n')
  );
}

/** Pad a string to a fixed width (truncates if too long). */
function col(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width - 1) + ' ';
  return value + ' '.repeat(width - value.length);
}

function printReleaseTable(points: ReleasePoint[]): void {
  const header = col('Title', 8) + col('Public Law', 16) + col('Date (ET)', 14) + 'URL';
  const separator = '-'.repeat(header.length);
  process.stdout.write(header + '\n');
  process.stdout.write(separator + '\n');
  for (const p of points) {
    const date = p.dateET.slice(0, 10); // YYYY-MM-DD
    process.stdout.write(
      col(p.title, 8) + col(p.publicLaw, 16) + col(date, 14) + p.uslmUrl + '\n'
    );
  }
  process.stdout.write(`\n${points.length} title(s)\n`);
}

interface HistoricalPoint {
  publicLaw: string;
  congress: string;
  law: string;
  dateET: string;
  path: string;
}

function printHistoryTable(points: HistoricalPoint[]): void {
  const header = col('Public Law', 16) + col('Congress', 12) + col('Law', 16) + col('Date (ET)', 14) + 'Path';
  const separator = '-'.repeat(header.length);
  process.stdout.write(header + '\n');
  process.stdout.write(separator + '\n');
  for (const p of points) {
    const date = p.dateET.slice(0, 10);
    process.stdout.write(
      col(p.publicLaw, 16) + col(p.congress, 12) + col(p.law, 16) + col(date, 14) + p.path + '\n'
    );
  }
  process.stdout.write(`\n${points.length} release point(s)\n`);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--all' || arg === '--help') {
      args[arg.slice(2)] = true;
    } else if (arg === '--title' && i + 1 < argv.length) {
      const next = argv[++i];
      if (next !== undefined) args['title'] = next;
    } else if (!arg.startsWith('--')) {
      args['command'] = arg;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList(fetcher: OlrcFetcher): Promise<void> {
  process.stdout.write('Fetching current release points…\n\n');
  const result = await fetcher.listReleasePoints();
  if (!result.ok) {
    process.stderr.write(`Error: ${result.error.message}\n`);
    process.exit(1);
  }
  printReleaseTable(result.value);
}

async function cmdHistory(fetcher: OlrcFetcher): Promise<void> {
  process.stdout.write('Fetching historical release points…\n\n');
  const result = await fetcher.listHistoricalReleasePoints();
  if (!result.ok) {
    process.stderr.write(`Error: ${result.error.message}\n`);
    process.exit(1);
  }
  printHistoryTable(result.value);
}

async function cmdDownload(
  fetcher: OlrcFetcher,
  args: Record<string, string | boolean>
): Promise<void> {
  const downloadAll = args['all'] === true;
  const titleArg = typeof args['title'] === 'string' ? args['title'] : undefined;

  if (!downloadAll && titleArg === undefined) {
    process.stderr.write('Error: download requires --title <N> or --all\n');
    printUsage();
    process.exit(1);
  }

  // Resolve release point(s)
  const listResult = await fetcher.listReleasePoints(downloadAll ? undefined : titleArg);
  if (!listResult.ok) {
    process.stderr.write(`Error listing release points: ${listResult.error.message}\n`);
    process.exit(1);
  }

  const points = listResult.value;
  if (points.length === 0) {
    process.stderr.write(`No release points found${titleArg !== undefined ? ` for title ${titleArg}` : ''}.\n`);
    process.exit(1);
  }

  process.stdout.write(`Downloading ${points.length} title(s)…\n`);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const point of points) {
    process.stdout.write(`  Title ${point.title} (${point.publicLaw})… `);
    const result = await fetcher.fetchXml(point);
    if (!result.ok) {
      process.stdout.write('FAILED\n');
      process.stderr.write(`    Error: ${result.error.message}\n`);
      failed++;
    } else if (result.value === '') {
      process.stdout.write('unchanged (skipped)\n');
      skipped++;
    } else {
      // result.value is base64-encoded ZIP content
      const bytes = Buffer.from(result.value, 'base64').length;
      process.stdout.write(`OK (${bytes.toLocaleString()} bytes, base64 ZIP)\n`);
      succeeded++;
    }
  }

  process.stdout.write(`\nDone: ${succeeded} downloaded, ${skipped} unchanged, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args['help'] === true || argv.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args['command'];
  if (command === undefined) {
    process.stderr.write('Error: no command specified\n\n');
    printUsage();
    process.exit(1);
  }

  const logger = createLogger('openlaw-fetch');
  const fetcher = new OlrcFetcher({ logger });

  switch (command) {
    case 'list':
      await cmdList(fetcher);
      break;
    case 'history':
      await cmdHistory(fetcher);
      break;
    case 'download':
      await cmdDownload(fetcher, args);
      break;
    default:
      process.stderr.write(`Error: unknown command "${command}"\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
