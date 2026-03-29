import { type PrecedentAnnotation, PrecedentAnnotationSchema, type Result, ok, err } from '@civic-source/types';
import { type Logger, createLogger, TokenBucket } from '@civic-source/shared';
import { type CourtListenerResult, CourtListenerClient } from './client.js';
import { COURT_PRIORITY, MAX_HOLDING_SUMMARY_LENGTH, RATE_LIMIT_PER_HOUR, getApiToken } from './constants.js';
import { deduplicateCases } from './citation-utils.js';

/** Result of annotating a section, including the output path */
export interface AnnotationResult {
  annotation: PrecedentAnnotation;
  /** Relative output path: annotations/title-{n}/chapter-{n}/section-{n}.yaml */
  path: string;
}

type CourtType = 'SCOTUS' | 'Appellate' | 'District';

/** Map a CourtListener court ID to the schema court enum */
export function mapCourt(courtId: string): CourtType {
  const id = courtId.toLowerCase();
  if (id === 'scotus') return 'SCOTUS';
  // Federal appellate courts: ca1-ca11, cadc, cafc
  if (/^ca\d{1,2}$/.test(id) || id === 'cadc' || id === 'cafc') return 'Appellate';
  // Everything else is treated as District
  return 'District';
}

/** Sort results by court priority (SCOTUS first, then Appellate, then District) */
function sortByCourtPriority(results: CourtListenerResult[]): CourtListenerResult[] {
  return [...results].sort((a, b) => {
    const aPriority = COURT_PRIORITY[mapCourt(a.court)] ?? 2;
    const bPriority = COURT_PRIORITY[mapCourt(b.court)] ?? 2;
    return aPriority - bPriority;
  });
}

/** Truncate snippet to a maximum length for holding summary */
function truncateSnippet(snippet: string): string {
  if (snippet.length <= MAX_HOLDING_SUMMARY_LENGTH) return snippet;
  return snippet.slice(0, MAX_HOLDING_SUMMARY_LENGTH - 3) + '...';
}

/**
 * Build the annotation output path from a section citation.
 * Input: "18 U.S.C. 111" -> "annotations/title-18/section-111.yaml"
 * Falls back to a sanitized slug when the citation doesn't match the expected pattern.
 */
export function buildAnnotationPath(section: string): string {
  const match = /^(\d+[a-zA-Z]?)\s+U\.S\.C\.\s+(\d+[a-zA-Z-]*)$/.exec(section);
  if (!match) {
    // Fallback: sanitize the section string into a safe filename
    const slug = section.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
    return `annotations/${slug}.yaml`;
  }
  const [, titleNum, sectionNum] = match;
  return `annotations/title-${titleNum}/section-${sectionNum}.yaml`;
}

/** Serialize a PrecedentAnnotation to simple YAML (no external deps) */
export function annotationToYaml(annotation: PrecedentAnnotation): string {
  const lines: string[] = [];
  lines.push(`targetSection: "${annotation.targetSection}"`);
  lines.push(`lastSyncedET: "${annotation.lastSyncedET}"`);
  lines.push('cases:');
  for (const c of annotation.cases) {
    lines.push(`  - caseName: "${c.caseName.replace(/"/g, '\\"')}"`);
    lines.push(`    citation: "${c.citation.replace(/"/g, '\\"')}"`);
    lines.push(`    court: "${c.court}"`);
    lines.push(`    date: "${c.date}"`);
    lines.push(`    holdingSummary: "${c.holdingSummary.replace(/"/g, '\\"')}"`);
    lines.push(`    sourceUrl: "${c.sourceUrl}"`);
    lines.push(`    impact: "${c.impact}"`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Annotate a US Code section with precedent cases from CourtListener.
 *
 * Coverage caveat: CourtListener does not index statute citations as structured
 * fields. This annotator uses full-text search (e.g., "18 U.S.C. 111"), so
 * results are approximate and may miss cases that cite the statute differently.
 */
export class Annotator {
  private readonly client: CourtListenerClient;
  private readonly logger: Logger;
  private readonly rateLimiter: TokenBucket;

  constructor(options?: { client?: CourtListenerClient; logger?: Logger; rateLimiter?: TokenBucket }) {
    this.logger = options?.logger ?? createLogger('Annotator');
    this.client = options?.client ?? new CourtListenerClient({
      token: getApiToken(),
      logger: this.logger,
    });
    this.rateLimiter = options?.rateLimiter ?? new TokenBucket({
      capacity: RATE_LIMIT_PER_HOUR,
      refillRate: Math.ceil(RATE_LIMIT_PER_HOUR / 3600),
      refillIntervalMs: 1000,
    });
  }

  /** Query CourtListener for a section and build a validated PrecedentAnnotation */
  async annotateSection(section: string): Promise<Result<AnnotationResult>> {
    const timer = this.logger.startTimer('annotateSection');
    this.logger.info('Annotating section', { section });

    // Rate limit check
    if (!this.rateLimiter.tryConsume()) {
      this.logger.warn('Rate limited, waiting for token', { section });
      await this.rateLimiter.waitAndConsume();
    }

    const searchResult = await this.client.searchByStatute(section);
    if (!searchResult.ok) {
      timer();
      return searchResult;
    }

    const sorted = sortByCourtPriority(searchResult.value);
    const isoNow = new Date().toISOString();

    const rawCases = sorted.map((result) => ({
      caseName: result.caseName,
      citation: result.citation[0] ?? '',
      court: mapCourt(result.court),
      date: result.dateFiled,
      holdingSummary: truncateSnippet(result.snippet),
      sourceUrl: `https://www.courtlistener.com${result.absolute_url}`,
      impact: 'interpretation' as const,
    }));

    const dedupedCases = deduplicateCases(rawCases);
    const duplicatesFound = rawCases.length - dedupedCases.length;

    const annotation: PrecedentAnnotation = {
      targetSection: section,
      lastSyncedET: isoNow,
      cases: dedupedCases,
    };

    const parsed = PrecedentAnnotationSchema.safeParse(annotation);
    if (!parsed.success) {
      timer();
      return err(new Error(`Schema validation failed: ${parsed.error.message}`));
    }

    const path = buildAnnotationPath(section);

    timer();
    this.logger.info('Annotation complete', {
      section,
      caseCount: dedupedCases.length,
      citationsProcessed: rawCases.length,
      duplicatesFound,
      path,
    });
    return ok({ annotation: parsed.data, path });
  }
}
