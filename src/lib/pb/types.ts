// Hand-rolled TypeScript types for PocketBase collections. These mirror
// pb_migrations/1746540000_initial_schema.js and are kept in sync
// manually (small enough surface; can switch to `pocketbase-typegen`
// after the migration settles if churn becomes painful).
//
// Record envelope: every PocketBase record has these system fields in
// addition to the user-defined ones.

// `curriculumMeta` is stored verbatim as JSON (no storage/UI transform), so
// both the record and the UI `Code` share the one `CurriculumMeta` shape.
import type { CurriculumMeta } from '@/lib/types';

export interface PbRecord {
  id: string;
  created: string; // ISO 8601
  updated: string; // ISO 8601
  collectionId: string;
  collectionName: string;
}

// --- Collection: users (auth) ----------------------------------------------

export interface UserRecord extends PbRecord {
  email: string;
  emailVisibility: boolean;
  verified: boolean;
  name?: string;
  avatarUrl?: string;
  // 'architect' = content lead (full app); 'editor' = individual medical
  // editor (My Backlog only). Optional because legacy rows predate the field;
  // read-time defaulting lives in src/lib/auth/roles.ts.
  role?: 'editor' | 'architect';
}

// --- Collection: specialties -----------------------------------------------

export interface SpecialtyRecord extends PbRecord {
  slug: string;
  name: string;
  source: string;
  sheetId?: string;
  xlsxPath?: string;
  lastSeededAt?: number;
  milestones?: string;
  region?: string;
  language?: string;
  /** When true the specialty runs coverage mapping only — consolidation,
   *  suggestions, backlog and drift are hidden, and the map-codes prompt
   *  drops the suggestion portion of its chain-of-thought. Reversible via
   *  the header toggle; flipping it off surfaces the separate
   *  "Generate suggestions" backfill stage. */
  mappingOnly?: boolean;
  /** Which content source(s) coverage mapping runs against:
   *  `'amboss'` (default), `'guidelines'`, or `'both'`. Empty/absent reads as
   *  `'amboss'` at the data layer. See `mapCodesWorkflow` dispatch. */
  mappingSource?: string;
  /** Which end-to-end workflow this specialty runs: `'full'` (default),
   *  `'mapping-only'`, or `'rag-corpus'`. Source of truth for the run mode;
   *  the data layer derives `mappingOnly` from it (`pipelineMode !== 'full'`).
   *  Legacy rows without this fall back to the `mappingOnly` boolean above. */
  pipelineMode?: string;
  /** Per-tab manual "mark step complete" override, keyed by tab segment
   *  (e.g. `''` for Overview, `'mapping'`). OR-merged with the
   *  auto-derived completion in `getTabsComplete`. */
  tabOverrides?: Record<string, boolean>;
  /** Legacy per-stage "mark step complete" override. Read fallback only;
   *  superseded by `pipelineStageStates`. */
  pipelineStageOverrides?: Record<string, boolean>;
  /** Legacy per-stage "skip step" flag. Read fallback only; superseded
   *  by `pipelineStageStates`. */
  pipelineStageSkipped?: Record<string, boolean>;
  /** Editor-controlled pipeline card state. Legacy
   *  `pipelineStageOverrides` / `pipelineStageSkipped` are read fallback
   *  only; new writes use this string state map. */
  pipelineStageStates?: Record<string, string>;
}

// --- Collection: studyPlans ------------------------------------------------

export interface StudyPlanRecord extends PbRecord {
  /** Owning curriculum plan slug (same value as `codes.specialtySlug`). */
  specialtySlug: string;
  name: string;
  /** Curriculum `category` strings this plan includes. */
  selectedCategories?: string[];
  /** Creator email (best effort; '' when unknown). */
  createdBy?: string;
}

// --- Collection: codes -----------------------------------------------------

export interface CodeRecord extends PbRecord {
  specialtySlug: string;
  specialty?: string;
  source?: string;
  code: string;
  category?: string;
  consolidationCategory?: string;
  description?: string;
  isInAMBOSS?: boolean;
  mappedAt?: number;
  /** ms since epoch — last time a consolidation-relevant field on this
   *  code changed value. Drives per-bucket staleness; see
   *  `deriveBucketStaleness` in `src/lib/workflows/consolidation/buckets.ts`. */
  consolidationInputChangedAt?: number;
  /** ms since epoch — stamped once this code has been processed for
   *  suggestions (by the combined full-mode map write or the separate
   *  "Generate suggestions" backfill). Unset means suggestions were never
   *  generated (vs. generated-but-empty), which the backfill stage targets. */
  suggestionsGeneratedAt?: number;
  articlesWhereCoverageIs?: CoveredSection[];
  notes?: string;
  gaps?: string;
  coverageLevel?: string;
  depthOfCoverage?: number;
  coverageArticleCount?: number;
  coverageSectionCount?: number;
  existingArticleUpdateCount?: number;
  newArticleSuggestionCount?: number;
  existingArticleUpdates?: SectionUpdate[];
  newArticlesNeeded?: NewArticle[];
  improvements?: string;
  // --- Question mapping track (curriculum-mapping) -------------------------
  // AMBOSS Qbank questions that cover this code, found by a separate agent via
  // the `search_questions` MCP tool. `questionCount` is the derived length for
  // the table column (the JSON blob is fetched only for the detail modal).
  questionsWhereCoverageIs?: QuestionRef[];
  questionCount?: number;
  // --- Guideline coverage track (source includes 'guidelines') -------------
  // Mirror of the AMBOSS coverage columns above, populated by the guidelines
  // mapping agent. Null/unset for amboss-only rows.
  isInGuidelines?: boolean;
  guidelineCoverageLevel?: string;
  guidelineDepthOfCoverage?: number;
  guidelineNotes?: string;
  guidelineGaps?: string;
  guidelinesWhereCoverageIs?: GuidelineCoverage[];
  guidelineCount?: number;
  guidelineRecommendationCount?: number;
  // --- Overall coverage track + provenance ---------------------------------
  /** Synthesized overall coverage when source='both'; equals the active
   *  source's level/score for single-source rows. Stats/overview read these
   *  with a `?? coverageLevel/depthOfCoverage` fallback. */
  overallCoverageLevel?: string;
  overallDepthOfCoverage?: number;
  /** Which source(s) produced this row's mapping: 'amboss' | 'guidelines' |
   *  'both'. Stamped at write time so the UI renders the right columns. */
  mappingSourceUsed?: string;
  // --- RAG-corpus literature search (denormalized) -------------------------
  // The durable per-code state lives in `codeLitSearchRuns`; these mirror the
  // latest result onto the code row so the mapping sheet can show a source
  // count / status without a join. Set by the code-lit-search callback.
  /** '' | 'running' | 'completed' | 'failed'. */
  litSearchStatus?: string;
  /** Number of sources gathered on the last completed run. */
  litSearchSourceCount?: number;
  /** ms since epoch — when the last successful lit search completed. */
  litSearchedAt?: number;
  // --- Curriculum-mapping time dimension -----------------------------------
  // Populated only for `curriculum-mapping` specialties; the curriculum
  // extractor records year/phase/timing for each block. JSON field.
  curriculumMeta?: CurriculumMeta;
  // --- Curriculum-mapping human-in-the-loop approval gate -------------------
  // Curriculum-mapping only; only `'approved'` codes are mapped. '' = pending.
  curriculumReviewStatus?: '' | 'approved' | 'rejected';
  curriculumReviewedAt?: number;
  curriculumReviewedBy?: string;
}

// --- Collection: codeCategories --------------------------------------------

export interface CodeCategoryRecord extends PbRecord {
  specialtySlug: string;
  codeCategory?: string;
  source?: string;
  areAllCodesRun?: boolean;
  isConsolidated?: boolean;
  /** ms since epoch — start time of this bucket's last primary
   *  consolidation run. Compared against codes' / the bucket's
   *  `*ChangedAt` to derive staleness. */
  consolidatedAt?: number;
  /** ms since epoch — bucket-level dirty stamp, set when a code leaves
   *  this bucket (the new bucket goes stale via the code's own stamp). */
  inputChangedAt?: number;
  description?: string;
  numCodes?: number;
  totalArticleCodes?: number;
  totalSectionCodes?: number;
  codesToIgnore?: string;
  numIncludedCodes?: number;
  includedArticleCodes?: unknown;
  numIncludedArticleCodes?: number;
  excludedArticleCodes?: unknown;
  numExcludedArticleCodes?: number;
  includedSectionCodes?: unknown;
  numIncludedSectionCodes?: number;
  excludedSectionCodes?: unknown;
  numExcludedSectionCodes?: number;
  totallyIgnoredCodes?: unknown;
  numTotallyIgnoredCodes?: number;
}

// --- Collection: articleReviews --------------------------------------------

export type ArticleReviewStatus = 'approved' | 'rejected';

export interface ArticleReviewRecord extends PbRecord {
  specialtySlug: string;
  /** PB id of the consolidatedArticles row this review covers.
   *  @deprecated Use `articleKey` for cross-collection joins —
   *  `articleRecordId` is unstable across consolidation re-runs. Kept
   *  for backwards compatibility during the keys migration; will be
   *  dropped in a follow-up release. */
  articleRecordId: string;
  /** Stable, content-derived identifier — see
   *  `src/lib/data/article-keys.ts`. Empty string for zombie rows
   *  whose `articleRecordId` no longer resolves (filtered out by the
   *  UI). */
  articleKey: string;
  status: ArticleReviewStatus;
  reviewerEmail?: string;
  /** ms since epoch */
  reviewedAt?: number;
  notes?: string;
}

// --- Collection: sectionReviews --------------------------------------------

export interface SectionReviewRecord extends PbRecord {
  specialtySlug: string;
  /** PB id of the consolidatedSections row this review covers.
   *  @deprecated Use `sectionKey` — see ArticleReviewRecord. */
  sectionRecordId: string;
  /** Stable, content-derived identifier — see `article-keys.ts`. */
  sectionKey: string;
  status: ArticleReviewStatus;
  reviewerEmail?: string;
  reviewedAt?: number;
  notes?: string;
}

// --- Collection: consolidationCategoryReviews ------------------------------

export type ConsolidationCategoryReviewStatus = 'flagged-for-rerun';

export interface ConsolidationCategoryReviewRecord extends PbRecord {
  specialtySlug: string;
  /** Source category from consolidatedArticles / consolidatedSections that
   *  this row gates. Unique within a specialty. */
  category: string;
  status: ConsolidationCategoryReviewStatus;
  reviewerEmail?: string;
  /** ms since epoch */
  reviewedAt?: number;
  notes?: string;
}

// --- Collection: articleBacklog --------------------------------------------

export type ArticleBacklogStatus =
  | 'unassigned'
  | 'waiting-for-sources'
  | 'sources-searched'
  | 'sources-approved'
  | 'ready-for-llm-draft'
  | 'ready-for-editing'
  | 'editing-in-progress'
  | 'ready-to-publish'
  | 'published';

export type ArticleBacklogType = 'new' | 'update';

export interface ArticleBacklogRecord extends PbRecord {
  specialtySlug: string;
  /** PB id of the newArticleSuggestions row this backlog state covers
   *  (type='new'), or the CMS articleId of the parent article being
   *  updated (type='update').
   *  @deprecated Use `articleKey` — see ArticleReviewRecord. */
  articleRecordId: string;
  /** Stable, content-derived identifier — see `article-keys.ts`. */
  articleKey: string;
  status: ArticleBacklogStatus;
  /** Discriminator between new-article backlog rows and update-article
   *  backlog rows. Existing rows without an explicit value default to
   *  'new' at the data layer for back-compat. */
  type?: ArticleBacklogType;
  assigneeEmail?: string;
  lastChangedByEmail?: string;
  /** ms since epoch */
  lastChangedAt?: number;
  notes?: string;
  /**
   * Editable per-article pointer to the latest draft's Google Drive folder.
   * Auto-filled by the n8n draft callback (early ping + on completion, so a
   * re-run overwrites it) and manually editable in the backlog + article modal.
   */
  draftFolderUrl?: string;
}

// --- Collection: articleSources --------------------------------------------

export type ArticleSourceType =
  | 'guideline'
  | 'systematic_review'
  | 'clinical_review'
  | 'meta_analysis'
  | 'case_report'
  | 'vet_content'
  | 'non_english'
  | 'other';

export type PredatoryJournalRisk = 'none' | 'low' | 'medium' | 'high' | 'predatory';

export interface ArticleSourceRecord extends PbRecord {
  specialtySlug: string;
  /** PB id of the newArticleSuggestions row this source is attached to.
   *  @deprecated Use `articleKey` — the PB id is orphaned by a
   *  consolidation re-run, the stable key survives. Kept for one
   *  release as a backfill safety net. */
  articleRecordId: string;
  /** Stable, content-derived article identifier (see
   *  `src/lib/data/article-keys.ts`). Survives consolidation re-runs,
   *  so the source list reattaches automatically. Optional on the
   *  type because pre-migration rows may have an empty value. */
  articleKey?: string;
  ribosomId?: string;
  title: string;
  doi?: string;
  url?: string;
  journal?: string;
  journalNlm?: string;
  sourceType?: ArticleSourceType;
  predatoryJournalRisk?: PredatoryJournalRisk;
  totalCitations?: number;
  impactFactor?: number;
  rank?: number;
  subtopics?: string;
  llmSummary?: string;
  justification?: string;
  superseded?: boolean;
  priority?: number;
  originalFilename?: string;
  geminiFilename?: string;
  uri?: string;
  mimeType?: string;
  /** ID returned by Cortex CMS after registering the source metadata
   *  (title, URL, authors, etc.). Populated by the Stage 2 trigger;
   *  empty until then. PDFs themselves are NOT uploaded to Cortex —
   *  only the source metadata. */
  cortexSourceId?: string;
  /** Editor decision on whether to keep this source. Empty / undefined
   *  means not yet reviewed. */
  reviewStatus?: SourceReviewStatus;
  reviewerEmail?: string;
  /** ms since epoch */
  reviewedAt?: number;
  /** Free-form editor notes attached to this source. */
  notes?: string;
}

export type SourceReviewStatus = 'approved' | 'rejected';

// --- Collection: articleLitSearchRuns --------------------------------------

export type ArticleLitSearchRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ArticleLitSearchRunRecord extends PbRecord {
  specialtySlug: string;
  articleKey: string;
  articleRecordId: string;
  runId?: string;
  status: ArticleLitSearchRunStatus;
  /** ms since epoch */
  startedAt?: number;
  /** ms since epoch */
  finishedAt?: number;
  errorMessage?: string;
  queryCount?: number;
  candidateCount?: number;
  sourcesCount?: number;
}

// --- Collection: codeLitSearchRuns -----------------------------------------
// Code/topic-level mirror of articleLitSearchRuns. Drives the RAG-corpus
// mapping-sheet literature search; keyed by the code's PB id (`codeId`).

export type CodeLitSearchRunStatus = ArticleLitSearchRunStatus;

export interface CodeLitSearchRunRecord extends PbRecord {
  specialtySlug: string;
  /** PB id of the `codes` row this run targets. */
  codeId: string;
  /** Human code string (e.g. ICD code) — denormalized for display/debugging. */
  code?: string;
  runId?: string;
  status: CodeLitSearchRunStatus;
  /** ms since epoch */
  startedAt?: number;
  /** ms since epoch */
  finishedAt?: number;
  errorMessage?: string;
  queryCount?: number;
  candidateCount?: number;
  sourcesCount?: number;
}

// --- Collection: codeLitSources --------------------------------------------
// Code/topic-level mirror of articleSources — the reference corpus gathered
// per code by the RAG-corpus literature search. Keyed by the code's PB id.
// (Named `codeLitSources` to avoid colliding with the unrelated `codeSources`
// registry collection — see `SourceRecord` below.)

export interface CodeLitSourceRecord extends PbRecord {
  specialtySlug: string;
  /** PB id of the `codes` row this source is attached to. */
  codeId: string;
  /** Human code string — denormalized for display/debugging. */
  code?: string;
  ribosomId?: string;
  title: string;
  doi?: string;
  url?: string;
  journal?: string;
  journalNlm?: string;
  sourceType?: ArticleSourceType;
  predatoryJournalRisk?: PredatoryJournalRisk;
  totalCitations?: number;
  impactFactor?: number;
  rank?: number;
  subtopics?: string;
  llmSummary?: string;
  justification?: string;
  superseded?: boolean;
  priority?: number;
  originalFilename?: string;
  geminiFilename?: string;
  uri?: string;
  mimeType?: string;
  cortexSourceId?: string;
  reviewStatus?: SourceReviewStatus;
  reviewerEmail?: string;
  /** ms since epoch */
  reviewedAt?: number;
  notes?: string;
}

// --- Collection: articleDraftRuns ------------------------------------------

export type ArticleDraftRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** One generated draft (a stage output) written to the Drive output folder. */
export interface ArticleDraftLink {
  /** File name as it lands in Drive, e.g. "isoniazid poisoning copy edit". */
  name: string;
  /** Shareable Google Docs / Drive URL for that file. */
  link: string;
}

export interface ArticleDraftRunRecord extends PbRecord {
  specialtySlug: string;
  articleKey: string;
  articleRecordId: string;
  status: ArticleDraftRunStatus;
  /** ms since epoch */
  startedAt?: number;
  /** ms since epoch */
  finishedAt?: number;
  errorMessage?: string;
  /** Editor handle/initials submitted with the draft (n8n `handle` field). */
  handle?: string;
  language?: string;
  articleLength?: string;
  /** Google Drive folder URL returned by the n8n callback on success. */
  outputUrl?: string;
  /**
   * Per-stage drafts written to the output folder (`primary edit`, …,
   * `copy edit`, `QC`), each as `{ name, link }`. Set by the success callback
   * alongside `outputUrl`. Empty/absent for legacy runs.
   */
  outputLinks?: ArticleDraftLink[];
}

// --- Collection: reviewComments --------------------------------------------

export type ReviewRecordKind = 'article' | 'section';

export interface ReviewCommentRecord extends PbRecord {
  specialtySlug: string;
  recordKind: ReviewRecordKind;
  /** PB id of the consolidatedArticles or consolidatedSections row this
   *  comment is attached to.
   *  @deprecated Use `recordKey` — see ArticleReviewRecord. */
  recordId: string;
  /** Stable, content-derived identifier — interpretation depends on
   *  `recordKind`: 'article' → articleKey, 'section' → sectionKey. */
  recordKey: string;
  authorEmail?: string;
  body: string;
}

// --- Collection: mappingsInFlight ------------------------------------------

export interface MappingInFlightRecord extends PbRecord {
  specialtySlug: string;
  code: string;
  runId: string;
  startedAt: number;
}

// --- Article suggestion shape (shared by new + update collections) ---------

export interface ArticleSuggestionRecord extends PbRecord {
  specialtySlug: string;
  /** Stable, content-derived identifier — see `article-keys.ts`. */
  articleKey?: string;
  category?: string;
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
  sectionName?: string;
  sectionId?: string;
  exists?: boolean;
  newSection?: boolean;
  sectionUpdate?: boolean;
  codes?: unknown[];
  previousSectionNames?: unknown;
  literatureSearchTerms?: string;
  sections?: string;
  previousArticleTitleSuggestions?: unknown;
  previousConsolidationIndexes?: unknown;
  existingAmbossCoverage?: string;
  overallCoverage?: number;
  overallImportance?: number;
  justification?: string;
  unique_title?: string;
  uniqueId?: string;
  isSearched?: boolean;
  llmSearchTerms?: string;
  verdict?: string;
  /** Convex schema preserves both spellings — kept for parity. */
  justifcation?: string;
  isSufficientlyCovered?: boolean;
  areAllSourcesFetched?: boolean;
}

export interface ConsolidatedArticleRecord extends PbRecord {
  specialtySlug: string;
  /** Stable, content-derived identifier — see `article-keys.ts`. */
  articleKey?: string;
  articleTitle?: string;
  articleType?: string;
  specialtyName?: string;
  category?: string;
  articleId?: string;
  numCodes?: number;
  codes?: unknown[];
  previousArticleTitleSuggestions?: unknown;
  overallCoverage?: number;
  overallImportance?: number;
  justification?: string;
}

// --- Collection: consolidatedSections --------------------------------------

export interface ConsolidatedSectionRecord extends PbRecord {
  specialtySlug: string;
  /** Stable, content-derived identifier — see `article-keys.ts`. */
  sectionKey?: string;
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
  codes?: unknown[];
  previousSectionNames?: unknown;
  exists?: boolean;
  sectionId?: string;
  overallCoverage?: number;
  overallImportance?: number;
  justification?: string;
  isSearched?: boolean;
  llmSearchTerms?: string;
  verdict?: string;
  justifcation?: string;
  isSufficientlyCovered?: boolean;
  areAllSourcesFetched?: boolean;
}

// --- Collection: contentChangeEvents ---------------------------------------

export type ContentChangeEventType =
  | 'renamed'
  | 'moved'
  | 'archived'
  | 'merged'
  | 'deleted';

export type ContentChangeEventStatus = 'open' | 'resolved';

/**
 * One CMS article/section change ingested from the content-change feed.
 * Events are CMS-global (no specialtySlug); specialty filtering happens
 * at join time in `computeDriftImpacts`. `eventKey` is the idempotency
 * key — re-syncing a window upserts on it. See
 * `src/lib/data/content-drift.ts`.
 */
export interface ContentChangeEventRecord extends PbRecord {
  eventKey: string;
  articleEid: string;
  sectionId?: string;
  changeType: ContentChangeEventType;
  newTitle?: string;
  mergedIntoEid?: string;
  /** ms since epoch — when the change happened in the CMS. */
  occurredAt?: number;
  /** ms since epoch — when this app ingested the event. */
  ingestedAt?: number;
  status: ContentChangeEventStatus;
  resolvedBy?: string;
  /** ms since epoch */
  resolvedAt?: number;
  notes?: string;
}

// --- Collection: integrationState ------------------------------------------

/** Generic key/value store. Holds the content-change feed cursor under
 *  key `contentChangeFeedCursor`. */
export interface IntegrationStateRecord extends PbRecord {
  key: string;
  value?: unknown;
}

// --- Ontology mirror tables ------------------------------------------------

export interface OntologyCodeRecord extends PbRecord {
  code: string;
  description?: string;
  parent?: string;
  category?: string;
}

// --- AMBOSS library mirror -------------------------------------------------

export interface AmbossArticleRecord extends PbRecord {
  articleId: string;
  title: string;
  contentBase?: string;
  updatedAt: number;
}

export interface AmbossSectionRecord extends PbRecord {
  sectionId: string;
  articleId: string;
  title: string;
  updatedAt: number;
}

// --- Source registries -----------------------------------------------------

export interface SourceRecord extends PbRecord {
  slug: string;
  name: string;
  createdAt: number;
}

// --- Pipeline --------------------------------------------------------------

export interface PipelineRunRecord extends PbRecord {
  specialtySlug: string;
  status: string;
  workflowRunId?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
  contentOutlineUrls?: ContentInput[];
  identifyModulesInstructions?: string;
  extractCodesInstructions?: string;
  milestonesInstructions?: string;
  mappingInstructions?: string;
  mappingCheckIds: boolean;
  mappingFilter?: MappingFilter;
  /** Set on per-category re-runs so the live UI can derive which
   *  buckets are currently rebuilding from a single `pipelineRuns`
   *  subscription. Null/undefined on full-specialty runs. */
  targetCategories?: string[];
  /** PocketBase relation field — string ID of the user record. */
  createdByUserId?: string;
}

export interface PipelineStageRecord extends PbRecord {
  runId: string;
  stage: string;
  status: string;
  workflowRunId?: string;
  startedAt?: number;
  finishedAt?: number;
  approvedAt?: number;
  approvedBy?: string;
  outputSummary?: unknown;
  draftPayload?: unknown;
  errorMessage?: string;
}

export interface PipelineEventRecord extends PbRecord {
  runId: string;
  stage: string;
  level: string;
  message: string;
  metrics?: unknown;
  createdAt: number;
}

export interface ExtractedCodeRecord extends PbRecord {
  runId: string;
  specialtySlug: string;
  code: string;
  category?: string;
  consolidationCategory?: string;
  description?: string;
  source?: string;
  metadata?: unknown;
  /** Curriculum block timing — staged here, promoted to `codes.curriculumMeta`. */
  curriculumMeta?: CurriculumMeta;
  createdAt: number;
}

// --- Collection: articleWritingRuns + articleDrafts ------------------------

export type ArticleWritingRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WritingPassName =
  | 'primary'
  | 'secondary'
  | 'proofreader'
  | 'style'
  | 'html'
  | 'copy';

export type ArticleDraftStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface ArticleWritingRunRecord extends PbRecord {
  specialtySlug: string;
  articleRecordId: string;
  status: ArticleWritingRunStatus;
  currentPass?: WritingPassName;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  requestedByEmail?: string;
  /** PB id of the user who clicked Start. Used by the dispatcher to
   *  resolve the per-user API key at dispatch time — the request-time
   *  cookie isn't available later. Empty for legacy rows + falls back
   *  to env-level keys at dispatch. */
  requestedByUserId?: string;
  language?: string;
  articleLength?: string;
  useTextBubbles?: boolean;
  modelProvider?: string;
  modelId?: string;
  modelReasoning?: string;
}

export interface ArticleDraftRecord extends PbRecord {
  runId: string;
  specialtySlug: string;
  articleRecordId: string;
  pass: WritingPassName;
  status: ArticleDraftStatus;
  output?: string;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  modelId?: string;
}

// --- Collection: userApiKeys -----------------------------------------------

export type ApiKeyTestStatus = 'ok' | 'failed';

export interface UserApiKeyRecord extends PbRecord {
  userId: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleTestedAt?: number;
  googleTestStatus?: ApiKeyTestStatus;
  anthropicTestedAt?: number;
  anthropicTestStatus?: ApiKeyTestStatus;
  openaiTestedAt?: number;
  openaiTestStatus?: ApiKeyTestStatus;
  updatedAt: number;
}

// --- Collection: otpRateLimit ----------------------------------------------

export interface OtpRateLimitRecord extends PbRecord {
  email: string;
  windowStart: number;
  count: number;
}

// --- Shared shapes embedded in JSON fields ---------------------------------

export interface SectionRef {
  sectionTitle?: string;
  sectionId?: string;
}

export interface CoveredSection {
  articleTitle?: string;
  articleId?: string;
  sections?: SectionRef[];
}

/** One AMBOSS Qbank question matched to a code by the question-mapping agent.
 *  `questionId` is the AMBOSS EID; the rest is the `search_questions` metadata
 *  (all optional — the agent fills what the tool returns). */
export interface QuestionRef {
  questionId?: string;
  questionStem?: string;
  studyObjectives?: string[];
  learningObjective?: string;
  competency?: string;
  system?: string;
  difficulty?: string;
}

/** A single recommendation/statement within a guideline the agent cited. */
export interface GuidelineRecommendationRef {
  recommendationTitle?: string;
  recommendationId?: string;
}

/** Guideline-coverage analog of {@link CoveredSection}. Shape is modelled
 *  defensively against the `get_guidelines` tool output — confirm/refine via
 *  `scripts/probe-guidelines.ts`. */
export interface GuidelineCoverage {
  guidelineTitle?: string;
  guidelineId?: string;
  organization?: string;
  year?: number;
  recommendations?: GuidelineRecommendationRef[];
}

export interface SectionUpdate {
  articleTitle?: string;
  articleId?: string;
  sections?: Array<{
    sectionTitle?: string;
    sectionId?: string;
    exists?: boolean;
    changes?: string;
    importance?: number;
  }>;
}

export interface NewArticle {
  articleTitle?: string;
  importance?: number;
}

export interface ContentInput {
  source: string;
  url: string;
}

export interface MappingFilter {
  categories?: string[];
  codes?: string[];
}
