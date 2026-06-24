/**
 * UI-facing domain types. The PocketBase row shapes in `src/lib/pb/types.ts`
 * are the authoritative storage shapes, but UI components and the
 * `src/lib/data/*` adapters need stable TypeScript types they can pass
 * around without coupling every consumer to the storage layer.
 *
 * Plain TypeScript (no Zod) — runtime parsing for xlsx ingest lives in
 * the seed scripts (`scripts/_lib/xlsx.ts`).
 */

// --- Coverage --------------------------------------------------------------

export const COVERAGE_LEVELS = [
  'none',
  'student',
  'early-resident',
  'advanced-resident',
  'attending',
  'specialist',
] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

/**
 * Year-based coverage scale for `curriculum-mapping` specialties — how deeply
 * AMBOSS covers a curriculum topic relative to the medical-school year a
 * student reaches it. Parallel to {@link COVERAGE_LEVELS}; the curriculum
 * mapping agent emits one of these (score 0–5: none→year-1…→residency-ready).
 */
export const CURRICULUM_COVERAGE_LEVELS = [
  'none',
  'year-1',
  'year-2',
  'year-3',
  'year-4',
  'residency-ready',
] as const;
export type CurriculumCoverageLevel = (typeof CURRICULUM_COVERAGE_LEVELS)[number];

/** Every coverage-level string any mode can produce — for validators/lookups
 *  that must accept a level from any pipeline mode. */
export const ALL_COVERAGE_LEVELS = [
  ...COVERAGE_LEVELS,
  'year-1',
  'year-2',
  'year-3',
  'year-4',
  'residency-ready',
] as const;
export type AnyCoverageLevel = (typeof ALL_COVERAGE_LEVELS)[number];

// --- Specialty -------------------------------------------------------------

export type MappingSource = 'amboss' | 'guidelines' | 'both';

/**
 * Which end-to-end workflow a specialty runs, chosen at initialization:
 * - `'full'`              — map → suggestions → consolidate → articles (today's default).
 * - `'mapping-only'`      — coverage mapping only; nothing downstream.
 * - `'rag-corpus'`        — map against guidelines, then per-topic literature search
 *                           to build a reference corpus (no suggestions / consolidation
 *                           / drafting).
 * - `'curriculum-mapping'`— extract curriculum blocks (with a time dimension) from a
 *                           curriculum outline/PDF and map their coverage against
 *                           AMBOSS only; milestones target medical students. Like
 *                           `mapping-only`, nothing downstream (no suggestions /
 *                           consolidation / drafting).
 * The data layer derives the legacy `mappingOnly` flag as `pipelineMode !== 'full'`,
 * so every existing `mappingOnly` consumer keeps working unchanged.
 */
export type PipelineMode = 'full' | 'mapping-only' | 'rag-corpus' | 'curriculum-mapping';

export type Specialty = {
  slug: string;
  name: string;
  source: 'sheets' | 'xlsx' | 'manual' | 'board' | (string & {});
  sheetId?: string;
  xlsxPath?: string;
  /** Coverage-mapping-only mode. Derived from `pipelineMode !== 'full'`. */
  mappingOnly?: boolean;
  /** Which end-to-end workflow this specialty runs — see `PipelineMode`.
   *  Source of truth; `mappingOnly` is derived from it. Defaults to `'full'`. */
  pipelineMode?: PipelineMode;
  /** Which content source(s) mapping runs against — see
   *  `SpecialtyRecord.mappingSource`. Defaults to `'amboss'`; forced to
   *  `'guidelines'` for `'rag-corpus'` and to `'amboss'` for
   *  `'curriculum-mapping'` specialties. */
  mappingSource?: MappingSource;
};

// --- Curriculum mapping ----------------------------------------------------

export type CurriculumCadence = 'weekly' | 'monthly' | 'longitudinal';

/**
 * Time dimension for one curriculum block / course / longitudinal item,
 * extracted from a curriculum outline. Curricula vary, so timing is captured
 * in priority order — calendar start/end month → duration → cadence — and
 * every field is optional. The extractor records whatever the source provides
 * and never synthesizes missing values.
 */
export type CurriculumMeta = {
  /** Program/academic year when stated (1, 2, 3, 4 …). */
  year?: number;
  /** Phase/stage label: 'Pre-Clerkship' | 'Clerkship' | 'Post-Clerkship' | source label. */
  phase?: string;
  /** Calendar month when the source places the block on a timeline, e.g. 'Sep' / '2026-09'. */
  startMonth?: string;
  endMonth?: string;
  /** Numeric duration in weeks when stated. */
  durationWeeks?: number;
  /** Verbatim timeframe text: '15 wks', 'Month 1–6', '6 months'. */
  durationLabel?: string;
  /** Longitudinal recurring items (start/end usually absent). */
  cadence?: CurriculumCadence;
};

// --- Code ------------------------------------------------------------------

export type ArticleCoverageRef = {
  articleTitle?: string;
  articleId?: string;
  sectionName?: string;
  [key: string]: unknown;
};

export type ArticleUpdate = {
  articleTitle?: string;
  articleId?: string;
  sectionName?: string;
  suggestion?: string;
  [key: string]: unknown;
};

export type NewArticleRef = {
  articleTitle?: string;
  justification?: string;
  [key: string]: unknown;
};

export type GuidelineRecommendationRef = {
  recommendationTitle?: string;
  recommendationId?: string;
};

export type GuidelineCoverageRef = {
  guidelineTitle?: string;
  guidelineId?: string;
  organization?: string;
  year?: number;
  recommendations?: GuidelineRecommendationRef[];
  [key: string]: unknown;
};

/** One AMBOSS Qbank question matched to a code (curriculum-mapping question
 *  track). `questionId` is the AMBOSS EID; the rest is `search_questions`
 *  metadata. Mirrors the storage shape in `pb/types` `QuestionRef`. */
export type QuestionCoverageRef = {
  questionId?: string;
  questionStem?: string;
  studyObjectives?: string[];
  learningObjective?: string;
  competency?: string;
  system?: string;
  difficulty?: string;
  [key: string]: unknown;
};

export type Code = {
  /** PocketBase record id. Present on rows sourced from the codes table
   *  (`CodeTableRow`); used to scope per-code literature search / sources. */
  id?: string;
  index?: string;
  specialty?: string;
  source?: string;
  code: string;
  category?: string;
  consolidationCategory?: string;
  description?: string;
  isInAMBOSS?: boolean;
  mappedAt?: number;
  articlesWhereCoverageIs?: ArticleCoverageRef[];
  notes?: string;
  gaps?: string;
  /** Clinician scale (none→specialist) for most modes; year-based
   *  (none→residency-ready) for `curriculum-mapping`. */
  coverageLevel?: AnyCoverageLevel;
  depthOfCoverage?: number;
  coverageArticleCount?: number;
  coverageSectionCount?: number;
  existingArticleUpdateCount?: number;
  newArticleSuggestionCount?: number;
  existingArticleUpdates?: ArticleUpdate[];
  newArticlesNeeded?: NewArticleRef[];
  improvements?: string;
  // --- Question mapping track (curriculum-mapping) --------------------------
  questionsWhereCoverageIs?: QuestionCoverageRef[];
  questionCount?: number;
  // --- Guideline coverage track ---------------------------------------------
  isInGuidelines?: boolean;
  guidelineCoverageLevel?: CoverageLevel;
  guidelineDepthOfCoverage?: number;
  guidelineNotes?: string;
  guidelineGaps?: string;
  guidelinesWhereCoverageIs?: GuidelineCoverageRef[];
  guidelineCount?: number;
  guidelineRecommendationCount?: number;
  // --- Overall coverage track + provenance ----------------------------------
  overallCoverageLevel?: AnyCoverageLevel;
  overallDepthOfCoverage?: number;
  mappingSourceUsed?: MappingSource;
  // --- RAG-corpus literature search (denormalized) --------------------------
  litSearchStatus?: string;
  litSearchSourceCount?: number;
  litSearchedAt?: number;
  // --- Curriculum-mapping time dimension ------------------------------------
  curriculumMeta?: CurriculumMeta;
  metadata?: unknown;
  fullJsonOutput?: unknown;
};

// --- Code categories -------------------------------------------------------

export type CodeCategory = {
  codeCategory?: string;
  source?: string;
  areAllCodesRun?: boolean;
  isConsolidated?: boolean;
  description?: string;
  numCodes?: number;
  totalArticleCodes?: number;
  totalSectionCodes?: number;
  codesToIgnore?: string;
  numIncludedCodes?: number;
  includedArticleCodes?: string[];
  numIncludedArticleCodes?: number;
  excludedArticleCodes?: string[];
  numExcludedArticleCodes?: number;
  includedSectionCodes?: string[];
  numIncludedSectionCodes?: number;
  excludedSectionCodes?: string[];
  numExcludedSectionCodes?: number;
  totallyIgnoredCodes?: string[];
  numTotallyIgnoredCodes?: number;
};

// --- Articles --------------------------------------------------------------

export type ConsolidatedArticle = {
  /** PB record id (preserved by the data layer for the review-pass keying). */
  id?: string;
  /** Stable, content-derived identifier — see `lib/data/article-keys.ts`. */
  articleKey?: string;
  index?: string;
  articleTitle?: string;
  articleType?: string;
  specialtyName?: string;
  category?: string;
  articleId?: string;
  numCodes?: number;
  codes?: Array<Record<string, unknown>>;
  previousArticleTitleSuggestions?: string[];
  overallCoverage?: number;
  overallImportance?: number;
  justification?: string;
};

export type NewArticleSuggestion = {
  id?: string;
  /** Stable, content-derived identifier — see `lib/data/article-keys.ts`. */
  articleKey?: string;
  index?: string;
  assignedEditor?: string;
  editorInTheLoopReview?: string;
  newArticle?: boolean;
  articleMaintenance?: boolean;
  articleTitle?: string;
  alternateTitles?: string;
  articleProgress?: string;
  articleType?: string;
  specialtyName?: string;
  articleId?: string;
  codes?: Array<Record<string, unknown>>;
  literatureSearchTerms?: string;
  sections?: string;
  previousArticleTitleSuggestions?: string[];
  previousConsolidationIndexes?: number[];
  existingAmbossCoverage?: string;
  overallImportance?: number;
  justification?: string;
  isSearched?: boolean;
  llmSearchTerms?: string;
  verdict?: string;
  justifcation?: string; // legacy typo preserved — present in xlsx fixtures
  isSufficientlyCovered?: boolean;
  areAllSourcesFetched?: boolean;
};

export type ArticleUpdateSuggestion = NewArticleSuggestion & {
  articleType?: string;
  sectionName?: string;
  sectionId?: string;
  exists?: boolean;
  newSection?: boolean;
  sectionUpdate?: boolean;
  previousSectionNames?: string[];
  overallCoverage?: number;
  unique_title?: string;
  uniqueId?: string;
};

// --- Sections --------------------------------------------------------------

export type ConsolidatedSection = {
  /** PB record id (preserved for the review-pass keying). */
  id?: string;
  /** Stable, content-derived identifier — see `lib/data/article-keys.ts`. */
  sectionKey?: string;
  index?: string;
  assignedEditor?: string;
  editorInTheLoopReview?: string;
  articleTitle?: string;
  articleType?: string;
  articleId?: string;
  sectionName?: string;
  newSection?: boolean;
  sectionUpdate?: boolean;
  newPhrase?: string;
  specialtyName?: string;
  category?: string;
  unique_title?: string;
  uniqueId?: string;
  numCodes?: number;
  codes?: Array<Record<string, unknown>>;
  previousSectionNames?: string[];
  exists?: boolean;
  sectionId?: string;
  overallCoverage?: number;
  overallImportance?: number;
  justification?: string;
  isSearched?: boolean;
  llmSearchTerms?: string;
  verdict?: string;
  justifcation?: string; // legacy typo preserved — present in xlsx fixtures
  isSufficientlyCovered?: boolean;
  areAllSourcesFetched?: boolean;
};

// --- Source ontologies -----------------------------------------------------

export type IcdCode = {
  codeCategory?: string;
  codeCategoryDescription?: string;
  icd10Code?: string;
  icd10CodeDescription?: string;
};

export type AbimCode = {
  Index?: string;
  primaryCategory?: string;
  secondaryCategory?: string;
  tertiaryCategory?: string;
  disease?: string;
  Specialty?: string;
  code?: string;
  item?: string;
  choice?: string;
  category?: string;
  count?: number;
};

export type OrphaCode = {
  orphaCode?: string;
  parentOrphaCode?: string;
  specificName?: string;
  parentCategory?: string;
  orphaTargetFilenamesToInclude?: string;
  icd10lettersToInclude?: string;
  count?: number;
};

export const ONTOLOGY_SOURCES = ['ICD10', 'HCUP', 'ABIM', 'Orpha'] as const;
export type OntologySource = (typeof ONTOLOGY_SOURCES)[number];

// --- Stats -----------------------------------------------------------------

export type StatsSummary = {
  totalCodes?: number;
  completedMappings?: number;
  icdTotalItems?: number;
  icdCompletedRuns?: number;
  coverageScoreBuckets?: Array<{ score: number; count: number; percentage: number }>;
  raw?: Array<Array<string | number | null>>;
};
