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

// --- Collection: reviewComments --------------------------------------------

export type ReviewRecordKind = 'article' | 'section' | 'parent-article';

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
