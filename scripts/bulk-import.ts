#!/usr/bin/env npx tsx
/**
 * Bulk import US Code titles from OLRC at release point PL 119-73.
 *
 * Usage:
 *   npx tsx scripts/bulk-import.ts
 *
 * Writes markdown sections to the civic-source-us-code repo.
 * Requires: packages to be built first (`pnpm build`).
 */

import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, statSync } from 'node:fs';

const execFileAsync = promisify(execFile);

const OUTPUT_ROOT = '/home/william/git/civic-source-us-code';
const RELEASE_POINT = 'PL 119-73';
const TITLES = ['02', '03', '06', '08', '09', '10', '13', '17', '20', '23'];

function buildUrl(paddedTitle: string): string {
  return `https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc${paddedTitle}@119-73.zip`;
}

/** Find the first .xml file in a directory (recursively) */
function findXmlFile(dir: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.xml')) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findXmlFile(fullPath);
      if (found) return found;
    }
  }
  return null;
}

interface TitleResult {
  title: string;
  sections: number;
  error?: string;
}

async function importTitle(paddedTitle: string): Promise<TitleResult> {
  const displayTitle = parseInt(paddedTitle, 10).toString();
  const url = buildUrl(paddedTitle);
  const tmpZip = `/tmp/usc-title-${paddedTitle}.zip`;
  const tmpDir = `/tmp/usc-title-${paddedTitle}`;

  console.log(`\n=== Title ${displayTitle} ===`);
  console.log(`Downloading: ${url}`);

  try {
    // Download
    await execFileAsync('curl', ['-sL', '-o', tmpZip, url], { timeout: 60000 });
    const zipStat = statSync(tmpZip);
    console.log(`  Downloaded ${(zipStat.size / 1024 / 1024).toFixed(2)} MB`);

    // Check if it's a valid ZIP (non-empty, starts with PK)
    const header = await readFile(tmpZip);
    if (header.length < 100 || header[0] !== 0x50 || header[1] !== 0x4b) {
      console.error('  FAILED: Downloaded file is not a valid ZIP');
      return { title: displayTitle, sections: 0, error: 'Invalid ZIP' };
    }

    // Extract
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    await execFileAsync('unzip', ['-o', '-q', tmpZip, '-d', tmpDir], { timeout: 60000 });

    // Find XML
    const xmlPath = findXmlFile(tmpDir);
    if (!xmlPath) {
      console.error('  FAILED: No XML file found in ZIP');
      return { title: displayTitle, sections: 0, error: 'No XML in ZIP' };
    }

    const xml = await readFile(xmlPath, 'utf-8');
    console.log(`  Extracted XML: ${(xml.length / 1024).toFixed(1)} KB`);

    // Transform — use relative import since tsx doesn't resolve pnpm workspace for dynamic imports
    const { XmlToMarkdownAdapter } = await import('../packages/transformer/dist/index.js');
    const transformer = new XmlToMarkdownAdapter(RELEASE_POINT);
    const result = transformer.transformToFiles(xml);

    if (!result.ok) {
      console.error(`  FAILED: ${result.error.message}`);
      return { title: displayTitle, sections: 0, error: result.error.message };
    }

    const files = result.value;
    console.log(`  Transformed: ${files.length} sections`);

    // Write output
    for (const file of files) {
      const fullPath = join(OUTPUT_ROOT, file.path);
      const dir = dirname(fullPath);
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, file.content, 'utf-8');
    }

    console.log(`  Written to ${OUTPUT_ROOT}/statutes/title-${displayTitle}/`);

    // Cleanup
    await rm(tmpZip, { force: true });
    await rm(tmpDir, { recursive: true, force: true });

    return { title: displayTitle, sections: files.length };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED: ${msg}`);
    // Cleanup on failure too
    await rm(tmpZip, { force: true }).catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return { title: displayTitle, sections: 0, error: msg };
  }
}

async function main(): Promise<void> {
  const startTime = performance.now();
  const results: TitleResult[] = [];

  for (const paddedTitle of TITLES) {
    const result = await importTitle(paddedTitle);
    results.push(result);
  }

  const elapsed = performance.now() - startTime;

  console.log('\n\n=== BULK IMPORT SUMMARY ===');
  console.log(`Release point: ${RELEASE_POINT}`);
  console.log(`Time elapsed:  ${(elapsed / 1000).toFixed(1)}s`);
  console.log('');

  let totalSections = 0;
  for (const r of results) {
    const status = r.error ? `FAILED (${r.error})` : `${r.sections} sections`;
    console.log(`  Title ${r.title.padStart(2)}: ${status}`);
    totalSections += r.sections;
  }

  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;
  console.log('');
  console.log(`Succeeded: ${succeeded}/${results.length}`);
  console.log(`Failed:    ${failed}/${results.length}`);
  console.log(`Total sections: ${totalSections}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
