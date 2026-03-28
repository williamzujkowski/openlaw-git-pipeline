/** Pipeline metrics collector for observability and GitHub Actions job summaries. */

import { TIMEZONE } from '@civic-source/shared';

/** Recorded metrics for a pipeline run. */
export interface PipelineMetrics {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  titlesProcessed: number;
  titlesSkipped: number;
  titlesFailed: number;
  sectionsGenerated: number;
  annotationsGenerated: number;
  xmlDownloadSizeBytes: number;
  peakMemoryMB: number;
  runnerType: string;
}

/** Partial metric values that can be recorded incrementally. */
type RecordableMetrics = Partial<
  Pick<
    PipelineMetrics,
    | 'titlesProcessed'
    | 'titlesSkipped'
    | 'titlesFailed'
    | 'sectionsGenerated'
    | 'annotationsGenerated'
    | 'xmlDownloadSizeBytes'
    | 'peakMemoryMB'
    | 'runnerType'
  >
>;

/** Metrics collector with record/complete/export API. */
export interface MetricsCollector {
  /** Record incremental metric values (additive for counts, max for peakMemoryMB). */
  record(values: RecordableMetrics): void;
  /** Mark the run as complete, capturing completedAt and durationMs. */
  complete(): PipelineMetrics;
  /** Return the current metrics snapshot as a plain object. */
  toJSON(): PipelineMetrics;
  /** Render a GitHub Actions-compatible Markdown summary table. */
  toMarkdown(): string;
}

function nowET(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
}

/** Create a new pipeline metrics collector. */
export function createMetricsCollector(runnerType = 'self-hosted'): MetricsCollector {
  const startedAt = nowET();
  const startMs = performance.now();

  const state: PipelineMetrics = {
    startedAt,
    titlesProcessed: 0,
    titlesSkipped: 0,
    titlesFailed: 0,
    sectionsGenerated: 0,
    annotationsGenerated: 0,
    xmlDownloadSizeBytes: 0,
    peakMemoryMB: 0,
    runnerType,
  };

  function record(values: RecordableMetrics): void {
    if (values.titlesProcessed !== undefined) state.titlesProcessed += values.titlesProcessed;
    if (values.titlesSkipped !== undefined) state.titlesSkipped += values.titlesSkipped;
    if (values.titlesFailed !== undefined) state.titlesFailed += values.titlesFailed;
    if (values.sectionsGenerated !== undefined) state.sectionsGenerated += values.sectionsGenerated;
    if (values.annotationsGenerated !== undefined) state.annotationsGenerated += values.annotationsGenerated;
    if (values.xmlDownloadSizeBytes !== undefined) state.xmlDownloadSizeBytes += values.xmlDownloadSizeBytes;
    if (values.peakMemoryMB !== undefined) {
      state.peakMemoryMB = Math.max(state.peakMemoryMB, values.peakMemoryMB);
    }
    if (values.runnerType !== undefined) state.runnerType = values.runnerType;
  }

  function complete(): PipelineMetrics {
    state.completedAt = nowET();
    state.durationMs = Math.round(performance.now() - startMs);
    return { ...state };
  }

  function toJSON(): PipelineMetrics {
    return { ...state };
  }

  function toMarkdown(): string {
    const durationLabel = state.durationMs !== undefined
      ? `${(state.durationMs / 1000).toFixed(1)}s`
      : 'in progress';

    const lines = [
      '## Pipeline Run Summary',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Started | ${state.startedAt} ET |`,
      `| Duration | ${durationLabel} |`,
      `| Titles processed | ${state.titlesProcessed} |`,
      `| Titles skipped | ${state.titlesSkipped} |`,
      `| Titles failed | ${state.titlesFailed} |`,
      `| Sections generated | ${state.sectionsGenerated} |`,
      `| Annotations generated | ${state.annotationsGenerated} |`,
      `| XML download size | ${formatBytes(state.xmlDownloadSizeBytes)} |`,
      `| Peak memory | ${state.peakMemoryMB} MB |`,
      `| Runner | ${state.runnerType} |`,
    ];

    if (state.completedAt) {
      lines.splice(5, 0, `| Completed | ${state.completedAt} ET |`);
    }

    return lines.join('\n');
  }

  return { record, complete, toJSON, toMarkdown };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
