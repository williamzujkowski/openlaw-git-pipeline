/** USLM XML element names and transformer configuration */

/**
 * USLM namespace URI.
 * Note: OLRC publishes USLM 1.0 (http://xml.house.gov/schemas/uslm/1.0)
 * which uses `<uscDoc>` as root, while the USLM 2.0 spec uses `<lawDoc>`.
 * The namespace URI is the same; only the schema version and root element differ.
 */
export const USLM_NAMESPACE = 'https://xml.house.gov/schemas/uslm/1.0';

/** Structural USLM element names (hierarchy order) */
export const USLM_ELEMENTS = {
  /** Top-level document wrapper (USLM 2.0) */
  lawDoc: 'lawDoc',
  /** Top-level document wrapper (USLM 1.0, used by OLRC) */
  uscDoc: 'uscDoc',
  /** Main content wrapper (USLM 1.0 wraps content in <main>) */
  main: 'main',
  /** Title of the US Code (e.g., Title 26) */
  title: 'title',
  /** Subtitle grouping */
  subtitle: 'subtitle',
  /** Chapter grouping */
  chapter: 'chapter',
  /** Subchapter grouping */
  subchapter: 'subchapter',
  /** Part grouping */
  part: 'part',
  /** Subpart grouping */
  subpart: 'subpart',
  /** Division grouping */
  division: 'division',
  /** Individual section — primary unit of law */
  section: 'section',
  /** Subsection within a section */
  subsection: 'subsection',
  /** Paragraph within a subsection */
  paragraph: 'paragraph',
  /** Subparagraph */
  subparagraph: 'subparagraph',
  /** Clause */
  clause: 'clause',
  /** Subclause */
  subclause: 'subclause',
  /** Heading element */
  heading: 'heading',
  /** Section number/identifier */
  num: 'num',
  /** Content/text wrapper */
  content: 'content',
  /** Chapeau (introductory text before a list) */
  chapeau: 'chapeau',
  /** Note element */
  note: 'note',
  /** Cross-reference */
  ref: 'ref',
  /** Table element */
  table: 'table',
} as const;

/**
 * Legal list markers by nesting depth.
 * (a) → (1) → (A) → (i) → (I) → (aa)
 */
export const LEGAL_LIST_MARKERS = [
  { prefix: '(', style: 'lower-alpha' },  // (a), (b), (c)
  { prefix: '(', style: 'decimal' },       // (1), (2), (3)
  { prefix: '(', style: 'upper-alpha' },   // (A), (B), (C)
  { prefix: '(', style: 'lower-roman' },   // (i), (ii), (iii)
  { prefix: '(', style: 'upper-roman' },   // (I), (II), (III)
  { prefix: '(', style: 'double-lower' },  // (aa), (bb), (cc)
] as const;

/** Indentation per nesting level (in spaces) */
export const INDENT_PER_LEVEL = 2;

/** Maximum nesting depth for safety (prevent runaway recursion) */
export const MAX_NESTING_DEPTH = 20;

/** Output directory structure pattern */
export const OUTPUT_PATH_PATTERN = 'statutes/title-{title}/chapter-{chapter}/section-{section}.md';
