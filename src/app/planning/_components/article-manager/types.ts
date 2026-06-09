// Shared types for the Article Manager modal family. Extracted verbatim from
// the former article-manager-modal-v2.tsx monolith.

import type {
  ArticleBacklogRecord,
  ArticleBacklogStatus,
  ArticleDraftRunRecord,
  ArticleLitSearchRunRecord,
  ArticleSourceRecord,
  ReviewCommentRecord,
} from '@/lib/pb/types';
import type { ArticleRow } from '../articles-view';
import type { BacklogRow } from '../backlog-view';
import type { CategoryLookup, TitleOriginLookup } from '../code-utils';
import type { SectionRow } from '../sections-view';

export type ReviewStatus = 'approved' | 'rejected';
export type ReviewMap = Record<string, ReviewStatus>;

export type ReviewerInfo = { reviewerEmail?: string; reviewedAt?: number };
export type ReviewerMap = Record<string, ReviewerInfo>;

export type ManagerOpener =
  | {
      type: 'new';
      stage: 'review-1st' | 'review-2nd';
      slug: string;
      articles: ArticleRow[];
      passLabel?: string;
      startAtId?: string;
      initialReviews: ReviewMap;
      initialReviewers: ReviewerMap;
      initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
      initialNotesByArticle: Record<string, string>;
      categoryLookup: CategoryLookup;
      titleOriginLookup: TitleOriginLookup;
      viewerEmail?: string;
      /**
       * Persist a single article decision through the parent's
       * `useApprovalState` hook. Passing `status: null` clears an
       * existing decision (reset). The parent applies an optimistic
       * patch, runs the server action, and rolls back on failure — the
       * modal awaits to know whether to move to the next row.
       */
      onDecideArticle: (
        articleKey: string,
        articleRecordId: string,
        status: ReviewStatus | null,
        notes?: string,
      ) => Promise<void>;
    }
  | {
      type: 'new';
      stage: 'backlog';
      slug: string;
      article: BacklogRow;
      currentStatus: ArticleBacklogStatus;
      /** Full backlog row at modal-open time. Used to seed the modal's
       *  PB realtime subscription so the live status survives updates
       *  from any source (other tabs, async pipelines, the editor's own
       *  clicks). Falls back to `currentStatus` if missing. */
      currentBacklogRow?: ArticleBacklogRecord;
      sources: ArticleSourceRecord[];
      litSearchRuns?: ArticleLitSearchRunRecord[];
      /** Latest draft run for this article (or null). Drives the animated
       *  "Drafting…" header badge and the Article-tab lifecycle controls. */
      draftRun?: ArticleDraftRunRecord | null;
      initialComments: ReviewCommentRecord[];
      initialNotes: string;
      categoryLookup: CategoryLookup;
      viewerEmail?: string;
      onStatusChange: (
        next: ArticleBacklogStatus,
        notes?: string,
      ) => void | Promise<void>;
      /** Called when the user clicks "Search sources" in the Phase 1
       *  panel. Polls the parent page so the badge + table reflect the
       *  new running row even when PB realtime is anonymous-blocked. */
      onPipelineActionTriggered?: () => void;
      /** Step to the previous/next backlog row. Undefined at edges. */
      onPrev?: () => void;
      onNext?: () => void;
      position?: { index: number; total: number };
    }
  | {
      type: 'update';
      stage: 'review-1st' | 'review-2nd';
      slug: string;
      sections: SectionRow[];
      startAtId?: string;
      initialViewMode?: 'section' | 'article';
      initialReviews: ReviewMap;
      initialReviewers: ReviewerMap;
      initialCommentsBySection: Record<string, ReviewCommentRecord[]>;
      initialCommentsByParentArticle: Record<string, ReviewCommentRecord[]>;
      initialNotesBySection: Record<string, string>;
      categoryLookup: CategoryLookup;
      titleOriginLookup: TitleOriginLookup;
      viewerEmail?: string;
      /** See `onDecideArticle` — same contract for sections. */
      onDecideSection: (
        sectionKey: string,
        sectionRecordId: string,
        status: ReviewStatus | null,
        notes?: string,
      ) => Promise<void>;
    }
  | {
      type: 'update';
      stage: 'backlog';
      slug: string;
      article: BacklogRow;
      sections: SectionRow[];
      currentStatus: ArticleBacklogStatus;
      currentBacklogRow?: ArticleBacklogRecord;
      initialComments: ReviewCommentRecord[];
      initialNotes: string;
      categoryLookup: CategoryLookup;
      viewerEmail?: string;
      onStatusChange: (
        next: ArticleBacklogStatus,
        notes?: string,
      ) => void | Promise<void>;
      /** Step to the previous/next backlog row. Undefined at edges. */
      onPrev?: () => void;
      onNext?: () => void;
      position?: { index: number; total: number };
    };

// Per-stage opener aliases — narrowed from the union for each view component.
export type ReviewOpener = Extract<
  ManagerOpener,
  { type: 'new'; stage: 'review-1st' | 'review-2nd' }
>;
export type BacklogOpener = Extract<ManagerOpener, { type: 'new'; stage: 'backlog' }>;
export type UpdateReviewOpener = Extract<
  ManagerOpener,
  { type: 'update'; stage: 'review-1st' | 'review-2nd' }
>;
export type BacklogUpdateOpener = Extract<
  ManagerOpener,
  { type: 'update'; stage: 'backlog' }
>;
