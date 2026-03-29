import type { PrecedentAnnotation } from '@civic-source/types';

/** A single case from the PrecedentAnnotation.cases array */
type CaseAnnotation = PrecedentAnnotation['cases'][number];

/** Normalize a legal citation for deduplication */
export function normalizeCitation(citation: string): string {
  return citation
    .replace(/\s+/g, ' ')
    .replace(/§\s*/g, 'Section ')
    .replace(/\bU\.S\.C\./g, 'USC')
    .trim()
    .toLowerCase();
}

/** Deduplicate cases by normalized citation, preserving first occurrence */
export function deduplicateCases(cases: CaseAnnotation[]): CaseAnnotation[] {
  const seen = new Set<string>();
  return cases.filter((c) => {
    const key = normalizeCitation(c.citation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
