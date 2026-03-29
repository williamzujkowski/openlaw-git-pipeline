/**
 * Scrape and parse OLRC prior release points into a chronological timeline.
 *
 * The OLRC publishes prior release points at:
 *   https://uscode.house.gov/download/releasepoints/
 *
 * Each release point directory has the structure:
 *   us/pl/{congress}/{law}/
 * and contains per-title ZIP files like:
 *   xml_usc{NN}@{congress}-{law}.zip
 */

import { OLRC_BASE_URL } from '../../packages/fetcher/src/index.js';

const PRIOR_RELEASE_POINTS_URL = `${OLRC_BASE_URL}/download/releasepoints/`;

/** A parsed release point identifier */
export interface ReleasePointId {
  /** Congress number (e.g. 113, 118, 119) */
  congress: number;
  /** Law number within that congress (e.g. 100, 73) */
  law: number;
  /** Display string: "PL {congress}-{law}" */
  label: string;
}

/**
 * Known major release points (one per congress end-of-session).
 * Used as fallback when the OLRC index page is unavailable.
 */
export const CACHED_RELEASE_POINTS: ReleasePointId[] = [
  // 113th Congress (2013-2014)
  { congress: 113, law: 100, label: 'PL 113-100' },
  { congress: 113, law: 235, label: 'PL 113-235' },
  // 114th Congress (2015-2016)
  { congress: 114, law: 113, label: 'PL 114-113' },
  { congress: 114, law: 254, label: 'PL 114-254' },
  // 115th Congress (2017-2018)
  { congress: 115, law: 97, label: 'PL 115-97' },
  { congress: 115, law: 232, label: 'PL 115-232' },
  // 116th Congress (2019-2020)
  { congress: 116, law: 92, label: 'PL 116-92' },
  { congress: 116, law: 260, label: 'PL 116-260' },
  // 117th Congress (2021-2022)
  { congress: 117, law: 81, label: 'PL 117-81' },
  { congress: 117, law: 200, label: 'PL 117-200' },
  // 118th Congress (2023-2024)
  { congress: 118, law: 31, label: 'PL 118-31' },
  { congress: 118, law: 100, label: 'PL 118-100' },
  // 119th Congress (2025-2026)
  { congress: 119, law: 4, label: 'PL 119-4' },
  { congress: 119, law: 73, label: 'PL 119-73' },
].sort((a, b) => {
  if (a.congress !== b.congress) return a.congress - b.congress;
  return a.law - b.law;
});

/** Compare release points chronologically (congress first, then law number) */
export function compareReleasePoints(a: ReleasePointId, b: ReleasePointId): number {
  if (a.congress !== b.congress) return a.congress - b.congress;
  return a.law - b.law;
}

/** Parse a "pl/{congress}/{law}" string into a ReleasePointId */
export function parseReleasePointStr(str: string): ReleasePointId | null {
  const match = /^pl\/(\d+)\/(\d+)$/i.exec(str);
  if (!match?.[1] || !match[2]) return null;
  const congress = parseInt(match[1], 10);
  const law = parseInt(match[2], 10);
  return { congress, law, label: `PL ${congress}-${law}` };
}

/**
 * Build the download URL for a specific title at a given release point.
 * Pattern: https://uscode.house.gov/download/releasepoints/us/pl/{congress}/{law}/xml_usc{NN}@{congress}-{law}.zip
 */
export function titleZipUrl(rp: ReleasePointId, paddedTitle: string): string {
  return `${PRIOR_RELEASE_POINTS_URL}us/pl/${rp.congress}/${rp.law}/xml_usc${paddedTitle}@${rp.congress}-${rp.law}.zip`;
}

/**
 * Scrape the OLRC release points index page and extract all PL directories.
 * Returns release points sorted chronologically (oldest first).
 * Falls back to CACHED_RELEASE_POINTS if the index page is unavailable.
 */
export async function scrapeReleasePoints(
  fetchFn: typeof fetch = fetch
): Promise<ReleasePointId[]> {
  try {
    const response = await fetchFn(PRIOR_RELEASE_POINTS_URL);
    if (response.ok) {
      const html = await response.text();
      const points: ReleasePointId[] = [];

      // Match directory links like: us/pl/113/100/ or /download/releasepoints/us/pl/119/73/
      const pattern = /href="[^"]*?us\/pl\/(\d+)\/(\d+)\/?"/gi;
      let match: RegExpExecArray | null;

      const seen = new Set<string>();
      while ((match = pattern.exec(html)) !== null) {
        const congress = match[1];
        const law = match[2];
        if (!congress || !law) continue;

        const key = `${congress}-${law}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const c = parseInt(congress, 10);
        const l = parseInt(law, 10);
        points.push({ congress: c, law: l, label: `PL ${c}-${l}` });
      }

      points.sort(compareReleasePoints);
      return points;
    }
  } catch {
    // Fall through to cached list
  }

  console.log('Using cached release points list (OLRC index unavailable)');
  return [...CACHED_RELEASE_POINTS];
}

/** Filter release points to a range (inclusive) */
export function filterRange(
  points: readonly ReleasePointId[],
  start?: ReleasePointId | undefined,
  end?: ReleasePointId | undefined
): ReleasePointId[] {
  return points.filter((p) => {
    if (start && compareReleasePoints(p, start) < 0) return false;
    if (end && compareReleasePoints(p, end) > 0) return false;
    return true;
  });
}
