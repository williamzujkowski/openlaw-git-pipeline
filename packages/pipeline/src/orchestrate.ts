import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { type ReleasePoint, type Result, ok, err } from '@civic-source/types';
import { OlrcFetcher, HashStore, createLogger } from '@civic-source/fetcher';
import { XmlToMarkdownAdapter } from '@civic-source/transformer';
import { Annotator } from '@civic-source/annotator';
import type { MarkdownFile } from '@civic-source/transformer';

const log = createLogger('pipeline');

/** Summary of a single title's pipeline run */
export interface TitleResult {
  title: string;
  sectionsTransformed: number;
  sectionsAnnotated: number;
  errors: string[];
}

/** Summary of the full pipeline run */
export interface PipelineResult {
  publicLaw: string;
  titlesProcessed: number;
  totalSectionsTransformed: number;
  totalSectionsAnnotated: number;
  titleResults: TitleResult[];
  skippedTitles: number;
  durationMs: number;
}

export interface OrchestrateOptions {
  /** Directory to write transformed statute Markdown files */
  outputDir: string;
  /** Optional: only process these title numbers */
  titles?: string[];
  /** Skip annotation step (useful for testing) */
  skipAnnotation?: boolean;
}

/**
 * Run the full pipeline: fetch release points, transform XML to Markdown,
 * and annotate sections with precedent cases.
 *
 * Returns a structured result with per-title metrics. Per-title failures
 * do not block other titles from processing.
 */
export async function orchestrate(
  options: OrchestrateOptions
): Promise<Result<PipelineResult>> {
  const start = performance.now();
  const timer = log.startTimer('Full pipeline');

  const fetcher = new OlrcFetcher({ hashStore: new HashStore() });

  // Step 1: Fetch release points
  log.info('Fetching release points');
  const releaseResult = await fetcher.listReleasePoints();
  if (!releaseResult.ok) {
    timer();
    return releaseResult;
  }

  let releasePoints = releaseResult.value;
  if (releasePoints.length === 0) {
    timer();
    return ok({
      publicLaw: 'None',
      titlesProcessed: 0,
      totalSectionsTransformed: 0,
      totalSectionsAnnotated: 0,
      titleResults: [],
      skippedTitles: 0,
      durationMs: Math.round(performance.now() - start),
    });
  }

  // Filter to requested titles if specified
  if (options.titles !== undefined && options.titles.length > 0) {
    releasePoints = releasePoints.filter((rp) =>
      options.titles!.includes(rp.title)
    );
  }

  const publicLaw = releasePoints[0]?.publicLaw ?? 'Unknown';
  const titleResults: TitleResult[] = [];
  let skippedTitles = 0;

  // Step 2: Process each title independently
  for (const releasePoint of releasePoints) {
    const titleResult = await processTitle(
      releasePoint,
      fetcher,
      options
    );

    if (titleResult === null) {
      skippedTitles++;
      continue;
    }

    titleResults.push(titleResult);
  }

  timer();

  const result: PipelineResult = {
    publicLaw,
    titlesProcessed: titleResults.length,
    totalSectionsTransformed: titleResults.reduce(
      (sum, t) => sum + t.sectionsTransformed,
      0
    ),
    totalSectionsAnnotated: titleResults.reduce(
      (sum, t) => sum + t.sectionsAnnotated,
      0
    ),
    titleResults,
    skippedTitles,
    durationMs: Math.round(performance.now() - start),
  };

  log.info('Pipeline complete', {
    titlesProcessed: result.titlesProcessed,
    totalSections: result.totalSectionsTransformed,
    skipped: result.skippedTitles,
    durationMs: result.durationMs,
  });

  return ok(result);
}

/**
 * Process a single title: fetch XML, transform to Markdown, optionally annotate.
 * Returns null if the content is unchanged (hash match).
 */
async function processTitle(
  releasePoint: ReleasePoint,
  fetcher: OlrcFetcher,
  options: OrchestrateOptions
): Promise<TitleResult | null> {
  const { title } = releasePoint;
  const errors: string[] = [];
  log.info('Processing title', { title });

  // Fetch XML (returns empty string if unchanged)
  const xmlResult = await fetcher.fetchXml(releasePoint);
  if (!xmlResult.ok) {
    log.error('Failed to fetch XML', { title, error: xmlResult.error.message });
    return { title, sectionsTransformed: 0, sectionsAnnotated: 0, errors: [xmlResult.error.message] };
  }

  if (xmlResult.value === '') {
    log.info('Title unchanged, skipping', { title });
    return null;
  }

  // Transform XML to Markdown files
  const transformer = new XmlToMarkdownAdapter(releasePoint.publicLaw);
  const transformResult = transformer.transformToFiles(xmlResult.value);
  if (!transformResult.ok) {
    log.error('Transform failed', { title, error: transformResult.error.message });
    return { title, sectionsTransformed: 0, sectionsAnnotated: 0, errors: [transformResult.error.message] };
  }

  const files = transformResult.value;

  // Write transformed files to output directory
  for (const file of files) {
    await writeMarkdownFile(options.outputDir, file);
  }

  log.info('Transformed title', { title, sections: files.length });

  // Annotate sections (if not skipped)
  let annotatedCount = 0;
  if (options.skipAnnotation !== true) {
    annotatedCount = await annotateSections(files, options.outputDir, errors);
  }

  return {
    title,
    sectionsTransformed: files.length,
    sectionsAnnotated: annotatedCount,
    errors,
  };
}

/** Write a single Markdown file to disk, creating directories as needed */
async function writeMarkdownFile(
  outputDir: string,
  file: MarkdownFile
): Promise<void> {
  const fullPath = join(outputDir, file.path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, file.content, 'utf-8');
}

/** Annotate transformed sections, writing annotation JSON alongside each Markdown file */
async function annotateSections(
  files: MarkdownFile[],
  outputDir: string,
  errors: string[]
): Promise<number> {
  const annotator = new Annotator();
  let count = 0;

  for (const file of files) {
    // Extract section reference from file path (e.g., "18 U.S.C. 111")
    const sectionRef = sectionRefFromPath(file.path);
    if (sectionRef === null) continue;

    const result = await annotator.annotateSection(sectionRef);
    if (!result.ok) {
      log.warn('Annotation failed for section', {
        section: sectionRef,
        error: result.error.message,
      });
      errors.push(`annotation:${sectionRef}: ${result.error.message}`);
      continue;
    }

    // Write annotation JSON alongside the Markdown file
    const annotationPath = file.path.replace(/\.md$/, '.annotations.json');
    const fullPath = join(outputDir, annotationPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(result.value, null, 2) + '\n', 'utf-8');
    count++;
  }

  return count;
}

/**
 * Derive a statute citation from a file path.
 * Path format: statutes/title-{n}/chapter-{n}/section-{n}.md
 * Returns e.g. "18 U.S.C. 111" or null if path doesn't match.
 */
function sectionRefFromPath(filePath: string): string | null {
  const match = /statutes\/title-(\d+[a-zA-Z]?)\/.*\/section-(\d+[a-zA-Z-]*)\.md$/.exec(
    filePath
  );
  if (!match) return null;
  const [, titleNum, sectionNum] = match;
  return `${titleNum} U.S.C. ${sectionNum}`;
}
