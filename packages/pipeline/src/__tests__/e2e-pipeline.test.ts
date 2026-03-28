import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end integration test that validates the pipeline against real OLRC data.
 *
 * This test downloads a real USLM XML file (Title 1 — General Provisions,
 * the smallest title with ~8 sections), transforms it, and validates the output.
 *
 * Only runs when RUN_E2E=true environment variable is set.
 * Network failures cause the test to skip, not fail.
 */

const RUN_E2E = process.env['RUN_E2E'] === 'true';

/** Known OLRC Title 1 XML ZIP URLs to try in order (newest first) */
const TITLE_1_URLS = [
  'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc01@119-73.zip',
  'https://uscode.house.gov/download/releasepoints/us/pl/118/100/xml_usc01@118-100.zip',
  'https://uscode.house.gov/download/releasepoints/us/pl/118/78/xml_usc01@118-78.zip',
];

/** Attempt to download a ZIP, returning the Buffer or null on failure */
async function tryDownload(urls: string[]): Promise<{ buffer: Buffer; url: string } | null> {
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      // Validate ZIP signature (PK header)
      if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
        return { buffer, url };
      }
    } catch {
      // Network error, rate limit, timeout — try next URL
      continue;
    }
  }
  return null;
}

/** Extract XML from a ZIP buffer using the system `unzip` command */
async function extractXmlFromZip(zipBuffer: Buffer): Promise<string | null> {
  const { writeFile, readdir, readFile, rm } = await import('node:fs/promises');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const tmpDir = await mkdtemp(join(tmpdir(), 'zip-extract-'));
  try {
    const zipPath = join(tmpDir, 'download.zip');
    await writeFile(zipPath, zipBuffer);
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', tmpDir], { timeout: 15_000 });

    const entries = await readdir(tmpDir);
    const xmlFile = entries.find((f) => f.endsWith('.xml'));
    if (!xmlFile) return null;

    return await readFile(join(tmpDir, xmlFile), 'utf-8');
  } catch {
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

describe.skipIf(!RUN_E2E)('E2E: Real OLRC Title 1 Pipeline', () => {
  let outputDir: string;

  it('downloads, transforms, and validates Title 1 XML', async () => {
    // Step 1: Download
    const download = await tryDownload(TITLE_1_URLS);
    if (download === null) {
      console.log('Skipping E2E: could not download Title 1 ZIP from OLRC (network or rate limit)');
      return;
    }

    console.log(`Downloaded Title 1 from: ${download.url} (${download.buffer.length} bytes)`);

    // Step 2: Extract XML from ZIP
    const xml = await extractXmlFromZip(download.buffer);
    expect(xml).not.toBeNull();
    if (xml === null) return;

    expect(xml.length).toBeGreaterThan(100);
    // OLRC uses <uscDoc> (USLM 1.0) or <lawDoc> (USLM 2.0)
    const hasRootElement = xml.includes('<lawDoc') || xml.includes('<uscDoc');
    expect(hasRootElement).toBe(true);

    // Step 3: Transform using the real transformer
    const { XmlToMarkdownAdapter } = await import('@civic-source/transformer');
    const transformer = new XmlToMarkdownAdapter('PL 118-100');
    const result = transformer.transformToFiles(xml);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      console.error('Transform failed:', result.error.message);
      return;
    }

    const files = result.value;

    // Validate: at least 1 section file
    expect(files.length).toBeGreaterThanOrEqual(1);
    console.log(`Transformed ${files.length} section files from Title 1`);

    // Step 4: Validate each file
    for (const file of files) {
      // File paths match /statutes/title-01/... pattern
      // Title 1 may appear as "1" in the identifier
      expect(file.path).toMatch(/^statutes\/title-\d+[a-zA-Z]?\/chapter-\d+[a-zA-Z]?\/section-\d+[a-zA-Z-]*\.md$/);

      // No empty section bodies
      expect(file.content.length).toBeGreaterThan(0);

      // Valid frontmatter exists
      expect(file.content).toMatch(/^---\n/);
      expect(file.content).toContain('title:');
      expect(file.content).toContain('current_through:');

      // Frontmatter has a closing delimiter
      const frontmatterEnd = file.content.indexOf('\n---\n', 4);
      expect(frontmatterEnd).toBeGreaterThan(0);

      // Body after frontmatter is not empty
      const body = file.content.slice(frontmatterEnd + 5).trim();
      expect(body.length).toBeGreaterThan(0);
    }

    // Step 5: Write to temp dir and verify on disk
    outputDir = await mkdtemp(join(tmpdir(), 'e2e-pipeline-'));
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');

    for (const file of files) {
      const fullPath = join(outputDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf-8');
    }

    // Verify files exist on disk
    const titleDir = join(outputDir, 'statutes');
    const entries = await readdir(titleDir, { recursive: true });
    const mdFiles = entries.filter((e) => String(e).endsWith('.md'));
    expect(mdFiles.length).toBe(files.length);

    // Read one file back and verify content roundtrip
    const firstFile = files[0];
    if (firstFile) {
      const content = await readFile(join(outputDir, firstFile.path), 'utf-8');
      expect(content).toBe(firstFile.content);
    }

    console.log(`E2E passed: ${files.length} sections written to ${outputDir}`);

    // Cleanup
    await rm(outputDir, { recursive: true, force: true });
  }, 60_000); // 60s timeout for network download
});
