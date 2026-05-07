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

// --- Specialty -------------------------------------------------------------

export type Specialty = {
  slug: string;
  name: string;
  source: 'sheets' | 'xlsx' | 'manual' | 'board' | (string & {});
  sheetId?: string;
  xlsxPath?: string;
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

export type Code = {
  index?: string;
  specialty?: string;
  source?: string;
  code: string;
  category?: string;
  consolidationCategory?: string;
  description?: string;
  isInAMBOSS?: boolean;
  articlesWhereCoverageIs?: ArticleCoverageRef[];
  notes?: string;
  gaps?: string;
  coverageLevel?: CoverageLevel;
  depthOfCoverage?: number;
  existingArticleUpdates?: ArticleUpdate[];
  newArticlesNeeded?: NewArticleRef[];
  improvements?: string;
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

export type ArticleUpdateSuggestion = NewArticleSuggestion;

// --- Sections --------------------------------------------------------------

export type ConsolidatedSection = {
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
