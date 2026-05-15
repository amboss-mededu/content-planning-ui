// Hand-rolled TypeScript types for PocketBase collections. These mirror
// pb_migrations/1746540000_initial_schema.js and are kept in sync
// manually (small enough surface; can switch to `pocketbase-typegen`
// after the migration settles if churn becomes painful).
//
// Record envelope: every PocketBase record has these system fields in
// addition to the user-defined ones.

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
  /** Per-tab manual "mark step complete" override, keyed by tab segment
   *  (e.g. `''` for Overview, `'categories'`). OR-merged with the
   *  auto-derived completion in `getTabsComplete`. */
  tabOverrides?: Record<string, boolean>;
  /** Per-pipeline-stage manual "mark step complete" override, keyed by
   *  stage name (e.g. `'map_codes'`). OR-merged with
   *  `stage.status === 'completed'` in the pipeline dashboard. */
  pipelineStageOverrides?: Record<string, boolean>;
  /** Per-pipeline-stage "skip step" flag, keyed by stage name. Renders
   *  the stage as "Skipped" (gray badge) instead of "Completed", and
   *  advances the last-completed-step chain the same way an override
   *  does. Only the 2nd-consolidation stages expose a skip toggle in
   *  the UI today. */
  pipelineStageSkipped?: Record<string, boolean>;
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
  articlesWhereCoverageIs?: CoveredSection[];
  notes?: string;
  gaps?: string;
  coverageLevel?: string;
  depthOfCoverage?: number;
  existingArticleUpdates?: SectionUpdate[];
  newArticlesNeeded?: NewArticle[];
  improvements?: string;
}

// --- Collection: codeCategories --------------------------------------------

export interface CodeCategoryRecord extends PbRecord {
  specialtySlug: string;
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
  /** PB id of the consolidatedArticles row this review covers. */
  articleRecordId: string;
  status: ArticleReviewStatus;
  reviewerEmail?: string;
  /** ms since epoch */
  reviewedAt?: number;
  notes?: string;
}

// --- Collection: sectionReviews --------------------------------------------

export interface SectionReviewRecord extends PbRecord {
  specialtySlug: string;
  /** PB id of the consolidatedSections row this review covers. */
  sectionRecordId: string;
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
   *  updated (type='update'). */
  articleRecordId: string;
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
  /** PB id of the newArticleSuggestions row this source is attached to. */
  articleRecordId: string;
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
  useFlag?: boolean;
  superseded?: boolean;
  priority?: number;
  originalFilename?: string;
  geminiFilename?: string;
  uri?: string;
  mimeType?: string;
}

// --- Collection: reviewComments --------------------------------------------

export type ReviewRecordKind = 'article' | 'section';

export interface ReviewCommentRecord extends PbRecord {
  specialtySlug: string;
  recordKind: ReviewRecordKind;
  /** PB id of the consolidatedArticles or consolidatedSections row this
   *  comment is attached to. */
  recordId: string;
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
  codes?: unknown[];
  literatureSearchTerms?: string;
  sections?: string;
  previousArticleTitleSuggestions?: unknown;
  previousConsolidationIndexes?: unknown;
  existingAmbossCoverage?: string;
  overallImportance?: number;
  justification?: string;
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
