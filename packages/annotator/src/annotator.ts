import { type PrecedentAnnotation, PrecedentAnnotationSchema, type Result, ok, err } from '@civic-source/types';
import { type CourtListenerResult, CourtListenerClient } from './client.js';
import { COURT_PRIORITY, MAX_HOLDING_SUMMARY_LENGTH, TIMEZONE, getApiToken } from './constants.js';
import { type Logger, createLogger } from './logger.js';

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
  return snippet.slice(0, MAX_HOLDING_SUMMARY_LENGTH) + '...';
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

  constructor(options?: { client?: CourtListenerClient; logger?: Logger }) {
    this.logger = options?.logger ?? createLogger('Annotator');
    this.client = options?.client ?? new CourtListenerClient({
      token: getApiToken(),
      logger: this.logger,
    });
  }

  /** Query CourtListener for a section and build a validated PrecedentAnnotation */
  async annotateSection(section: string): Promise<Result<PrecedentAnnotation>> {
    const timer = this.logger.startTimer('annotateSection');
    this.logger.info('Annotating section', { section });

    const searchResult = await this.client.searchByStatute(section);
    if (!searchResult.ok) {
      timer();
      return searchResult;
    }

    const sorted = sortByCourtPriority(searchResult.value);
    const now = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
    const isoNow = new Date(now).toISOString();

    const annotation: PrecedentAnnotation = {
      targetSection: section,
      lastSyncedET: isoNow,
      cases: sorted.map((result) => ({
        caseName: result.caseName,
        citation: result.citation.length > 0 ? result.citation[0] : '',
        court: mapCourt(result.court),
        date: result.dateFiled,
        holdingSummary: truncateSnippet(result.snippet),
        url: `https://www.courtlistener.com${result.absolute_url}`,
      })),
    };

    const parsed = PrecedentAnnotationSchema.safeParse(annotation);
    if (!parsed.success) {
      timer();
      return err(new Error(`Schema validation failed: ${parsed.error.message}`));
    }

    timer();
    this.logger.info('Annotation complete', { section, caseCount: annotation.cases.length });
    return ok(parsed.data);
  }
}
