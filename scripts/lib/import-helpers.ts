/**
 * Shared helpers for the historical import script:
 * state persistence, git operations, and ZIP download/extraction.
 */

import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';

import type { Logger } from '../../packages/shared/src/index.js';
import type { TokenBucket } from '../../packages/shared/src/index.js';

import { titleZipUrl, type ReleasePointId } from './release-points.js';

const execFileAsync = promisify(execFile);

const STATE_FILE = '.import-state.json';
const RATE_LIMIT_BACKOFF_MS = 30_000;

// --- Types ---

export interface ImportState {
  lastCompletedReleasePoint: string | null;
  manifests: Record<string, Record<string, string>>;
}

// --- State management ---

export async function loadState(repo: string): Promise<ImportState> {
  try {
    const raw = await readFile(join(repo, STATE_FILE), 'utf-8');
    return JSON.parse(raw) as ImportState;
  } catch {
    return { lastCompletedReleasePoint: null, manifests: {} };
  }
}

export async function saveState(repo: string, state: ImportState): Promise<void> {
  await writeFile(join(repo, STATE_FILE), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// --- Git operations ---

export async function gitCommit(repo: string, message: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: repo, timeout: 30_000 });
  await execFileAsync('git', ['commit', '-m', message, '--allow-empty'], {
    cwd: repo,
    timeout: 30_000,
  });
}

export async function gitTag(repo: string, tag: string): Promise<void> {
  await execFileAsync('git', ['tag', tag], { cwd: repo, timeout: 10_000 });
}

// --- Download + extract ---

function findXmlFile(dir: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.xml')) return fullPath;
    if (entry.isDirectory()) {
      const found = findXmlFile(fullPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns true if a response body looks like the OLRC "document not found" redirect page.
 * OLRC returns HTTP 200 after a 302→docnotfound redirect for unavailable titles.
 */
async function isDocNotFound(response: Response): Promise<boolean> {
  // Check content-type — the not-found page is HTML, not a ZIP binary
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    return true;
  }
  return false;
}

async function fetchWithRateRetry(
  url: string,
  log: Logger
): Promise<Response | null> {
  // Use manual redirect handling so we can detect 302→docnotfound sequences
  const response = await fetch(url, { redirect: 'follow' });
  if (response.status === 302 || response.status === 301) {
    // Should not happen with redirect:'follow', but guard anyway
    log.warn('Unexpected redirect not followed', { url, status: response.status });
    return null;
  }
  if (response.status === 404) return null;
  if (response.status === 429) {
    log.warn('Rate limited, waiting 30s', { url });
    await new Promise<void>((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
    const retry = await fetch(url, { redirect: 'follow' });
    if (!retry.ok) return null;
    if (await isDocNotFound(retry)) return null;
    return retry;
  }
  if (!response.ok) {
    log.warn('Download failed', { url, status: response.status });
    return null;
  }
  // OLRC sometimes returns 200 with an HTML "not found" page after an internal redirect
  if (await isDocNotFound(response)) {
    return null;
  }
  return response;
}

export async function downloadAndExtractXml(
  rp: ReleasePointId,
  paddedTitle: string,
  rateLimiter: TokenBucket,
  log: Logger
): Promise<string | null> {
  const url = titleZipUrl(rp, paddedTitle);
  const tmpZip = `/tmp/usc-hist-${paddedTitle}-${rp.congress}-${rp.law}.zip`;
  const tmpDir = `/tmp/usc-hist-${paddedTitle}-${rp.congress}-${rp.law}`;

  await rateLimiter.waitAndConsume();

  try {
    const response = await fetchWithRateRetry(url, log);
    if (!response) {
      log.info('Title not available at release point', {
        title: parseInt(paddedTitle, 10),
        releasePoint: `PL ${rp.congress}-${rp.law}`,
      });
      return null;
    }

    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      log.warn('Invalid ZIP', { url });
      return null;
    }

    await writeFile(tmpZip, buf);
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    await execFileAsync('unzip', ['-o', '-q', tmpZip, '-d', tmpDir], { timeout: 60_000 });

    const xmlPath = findXmlFile(tmpDir);
    if (!xmlPath) return null;

    return await readFile(xmlPath, 'utf-8');
  } finally {
    await rm(tmpZip, { force: true }).catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
