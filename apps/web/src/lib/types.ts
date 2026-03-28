import type { PrecedentAnnotation } from '@civic-source/types';

/** A single case annotation — extracted from PrecedentAnnotation.cases array */
export type CaseAnnotation = PrecedentAnnotation['cases'][number];

/** Re-export for convenience */
export type PrecedentData = PrecedentAnnotation;
