#!/usr/bin/env npx tsx
/**
 * Download and transform a single US Code title from OLRC for local testing.
 *
 * Usage:
 *   npx tsx scripts/fetch-title.ts --title 1 --output ./test-output/
 *
 * Requires: packages to be built first (`pnpm build`).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

// --- Argument parsing ---

const { values } = parseArgs({
  options: {
    title: { type: 'string', short: 't' },
    output: { type: 'string', short: 'o', default: './test-output' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help || !values.title) {
  console.log(`
Usage: npx tsx scripts/fetch-title.ts --title <N> [--output <dir>]

Options:
  --title, -t   Title number to download (required, e.g. "1" for Title 1)
  --output, -o  Output directory (default: ./test-output)
  --help, -h    Show this help message

Example:
  npx tsx scripts/fetch-title.ts --title 1 --output ./test-output/
`);
  process.exit(values.help ? 0 : 1);
}

const titleNum = values.title;
const outputDir = resolve(values.output ?? './test-output');

// --- Download logic ---

const OLRC_DOWNLOAD_PAGE = 'https://uscode.house.gov/download/download.shtml';

/** Discover the ZIP URL for a given title from the OLRC download page */
async function discoverTitleUrl(title: string): Promise<string | null> {
  console.log(`Discovering download URL for Title ${title}...`);
  const response = await fetch(OLRC_DOWNLOAD_PAGE);
  if (!response.ok) {
    console.error(`Failed to fetch OLRC download page: HTTP ${response.status}`);
    return null;
  }

  const html = await response.text();
  // Match links like: /download/releasepoints/us/pl/118/1/xml_usc01@118-100.zip
  // The title number is in the path segment after the congress number
  const padded = title.padStart(2, '0');
  const pattern = new RegExp(
    `href="([^"]*\\/releasepoints\\/us\\/pl\\/\\d+\\/\\d+\\/xml_usc${padded}@[^"]*\\.zip)"`,
    'i'
  );
  const match = pattern.exec(html);
  if (!match?.[1]) return null;

  const path = match[1];
  return path.startsWith('http') ? path : `https://uscode.house.gov${path}`;
}

/** Extract XML content from a ZIP buffer (simple parser for single-entry ZIPs) */
async function extractXmlFromZip(zipBuffer: Buffer): Promise<string | null> {
  let offset = 0;
  while (offset < zipBuffer.length - 30) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const fileName = zipBuffer.toString('utf-8', offset + 30, offset + 30 + fileNameLen);

    const dataStart = offset + 30 + fileNameLen + extraLen;

    if (fileName.endsWith('.xml')) {
      if (compressionMethod === 0) {
        return zipBuffer.toString('utf-8', dataStart, dataStart + compressedSize);
      } else if (compressionMethod === 8) {
        const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize);
        const chunks: Buffer[] = [];
        const inflater = createInflateRaw();
        const readable = Readable.from(compressed);
        inflater.on('data', (chunk: Buffer) => chunks.push(chunk));
        await pipeline(readable, inflater);
        return Buffer.concat(chunks).toString('utf-8');
      }
    }

    offset = dataStart + compressedSize;
  }
  return null;
}

// --- Main ---

async function main(): Promise<void> {
  const startTime = performance.now();
  const startMemory = process.memoryUsage();

  // Step 1: Discover URL
  const url = await discoverTitleUrl(titleNum);
  if (!url) {
    console.error(`Could not find download URL for Title ${titleNum} on OLRC download page.`);
    console.error('The title number may be invalid, or the page format may have changed.');
    process.exit(1);
  }
  console.log(`Found URL: ${url}`);

  // Step 2: Download ZIP
  console.log('Downloading ZIP...');
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Download failed: HTTP ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Step 3: Extract XML from ZIP
  console.log('Extracting XML from ZIP...');
  const xml = await extractXmlFromZip(buffer);
  if (!xml) {
    console.error('No XML file found in the downloaded ZIP.');
    process.exit(1);
  }
  console.log(`Extracted XML: ${(xml.length / 1024).toFixed(1)} KB`);

  // Step 4: Transform using the real transformer
  console.log('Transforming XML to Markdown...');
  const { XmlToMarkdownAdapter } = await import('@civic-source/transformer');
  const transformer = new XmlToMarkdownAdapter('Current');
  const result = transformer.transformToFiles(xml);

  if (!result.ok) {
    console.error(`Transform failed: ${result.error.message}`);
    process.exit(1);
  }

  const files = result.value;

  // Step 5: Write output files
  console.log(`Writing ${files.length} section files to ${outputDir}/...`);
  await mkdir(outputDir, { recursive: true });

  for (const file of files) {
    const fullPath = join(outputDir, file.path);
    const dir = dirname(fullPath);
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, file.content, 'utf-8');
  }

  // Summary
  const elapsed = performance.now() - startTime;
  const endMemory = process.memoryUsage();
  const memDelta = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

  console.log('\n--- Summary ---');
  console.log(`Title:               ${titleNum}`);
  console.log(`Sections generated:  ${files.length}`);
  console.log(`Output directory:    ${outputDir}`);
  console.log(`Time elapsed:        ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`Memory delta:        ${memDelta > 0 ? '+' : ''}${memDelta.toFixed(1)} MB heap`);
  console.log(`Peak RSS:            ${(endMemory.rss / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
