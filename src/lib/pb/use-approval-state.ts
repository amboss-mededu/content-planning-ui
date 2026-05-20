'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bulkApproveArticleReviews,
  bulkApproveSectionReviews,
  bulkUnapproveArticleReviews,
  bulkUnapproveSectionReviews,
  clearBacklogRow,
  resetArticleReview,
  resetSectionReview,
  submitArticleReview,
  submitSectionReview,
} from '@/app/planning/[specialty]/actions';
import type {
  ArticleBacklogRecord,
  ArticleReviewRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';
import {
  applyBacklogPatches,
  applyReviewPatches,
  type BacklogPatch,
  dropExpiredPatches,
  type ReviewPatch,
  reconcileBacklogPatches,
  reconcileReviewPatches,
} from './approval-patches';
import { useLiveCollection } from './use-live-collection';

/**
 * Shared client-side decision state for the four approval-aware screens
 * (Consolidation Review, New Articles, Article Updates, Backlog). All
 * four mount this hook, so they read from the same live PB subscriptions
 * and apply the same optimistic-patch model.
 *
 * Patch lifecycle:
 * 1. User clicks an action. Hook applies an optimistic patch (status
 *    override or tombstone). UI reflects the new state immediately.
 * 2. Hook awaits the server action. The action result is mostly used
 *    for error surfacing — its key list is informational here.
 * 3. PB realtime delivers the CREATE/UPDATE/DELETE event. The hook's
 *    `useLiveCollection` updates its live array.
 * 4. A reconciliation effect runs `reconcile{Review,Backlog}Patches`
 *    against the live arrays and drops patches whose target state is
 *    now reflected in live data. The patch lives until live convergence
 *    OR the TTL expires (6 s failsafe).
 *
 * This is the difference from the previous design: we don't drop
 * patches the moment the server responds, because realtime can lag
 * behind the action response and the row would briefly snap back to
 * the pre-patch state.
 */

export type ApprovalStateInitial = {
  articleReviews?: ArticleReviewRecord[];
  sectionReviews?: SectionReviewRecord[];
  backlog?: ArticleBacklogRecord[];
};

type ReviewStatus = 'approved' | 'rejected';

export type ApprovalActions = {
  approveArticles(
    pairs: Array<{ articleKey: string; articleRecordId: string }>,
  ): Promise<void>;
  unapproveArticles(
    pairs: Array<{ articleKey: string; articleRecordId: string }>,
  ): Promise<void>;
  approveSections(
    pairs: Array<{ sectionKey: string; sectionRecordId: string }>,
  ): Promise<void>;
  unapproveSections(
    pairs: Array<{ sectionKey: string; sectionRecordId: string }>,
  ): Promise<void>;
  /**
   * Single-row decision used by the article-manager modal. Pass
   * `status: null` to clear an existing decision (reset). Approving
   * also ensures the backlog row; clearing tears it down.
   */
  decideArticle(
    articleKey: string,
    articleRecordId: string,
    status: ReviewStatus | null,
    notes?: string,
  ): Promise<void>;
  /**
   * Single-row decision used by the article-manager modal for
   * sections. `status: null` is the reset path; approving ensures the
   * parent `upd::*` backlog row, clearing the last approved sibling
   * tears it down (server-side decision).
   */
  decideSection(
    sectionKey: string,
    sectionRecordId: string,
    status: ReviewStatus | null,
    notes?: string,
  ): Promise<void>;
  clearBacklog(articleKey: string): Promise<void>;
};

export type ApprovalState = ApprovalActions & {
  articleReviewRows: ArticleReviewRecord[];
  sectionReviewRows: SectionReviewRecord[];
  backlogRows: ArticleBacklogRecord[];
  articleReviewByKey: Record<string, ArticleReviewRecord>;
  sectionReviewByKey: Record<string, SectionReviewRecord>;
  backlogByKey: Record<string, ArticleBacklogRecord>;
  articleReviewStatus: (articleKey: string) => ReviewStatus | undefined;
  sectionReviewStatus: (sectionKey: string) => ReviewStatus | undefined;
  backlogRow: (articleKey: string) => ArticleBacklogRecord | undefined;
};

const EMPTY_ARTICLE_REVIEWS: ArticleReviewRecord[] = [];
const EMPTY_SECTION_REVIEWS: SectionReviewRecord[] = [];
const EMPTY_BACKLOG: ArticleBacklogRecord[] = [];

const articleReviewKey = (r: ArticleReviewRecord): string => r.articleKey;
const sectionReviewKey = (r: SectionReviewRecord): string => r.sectionKey;

export function useApprovalState(
  slug: string,
  initial?: ApprovalStateInitial,
): ApprovalState {
  const filter = `specialtySlug = "${slug}"`;
  const router = useRouter();

  const liveArticleReviews = useLiveCollection<ArticleReviewRecord>(
    'articleReviews',
    initial?.articleReviews ?? EMPTY_ARTICLE_REVIEWS,
    { filter },
  );
  const liveSectionReviews = useLiveCollection<SectionReviewRecord>(
    'sectionReviews',
    initial?.sectionReviews ?? EMPTY_SECTION_REVIEWS,
    { filter },
  );
  const liveBacklog = useLiveCollection<ArticleBacklogRecord>(
    'articleBacklog',
    initial?.backlog ?? EMPTY_BACKLOG,
    { filter },
  );

  const [reviewPatches, setReviewPatches] = useState<ReviewPatch[]>([]);
  const [backlogPatches, setBacklogPatches] = useState<BacklogPatch[]>([]);

  // Convergence reconciliation: whenever the live arrays change (e.g.
  // PB realtime delivered an event), drop any patches whose intent is
  // now reflected in live state. Patches that aren't yet confirmed by
  // live data stay in place until the TTL expires.
  useEffect(() => {
    setReviewPatches((prev) => {
      const a = reconcileReviewPatches(
        'articleReviews',
        prev,
        liveArticleReviews,
        articleReviewKey,
      );
      const b = reconcileReviewPatches(
        'sectionReviews',
        a,
        liveSectionReviews,
        sectionReviewKey,
      );
      return b;
    });
    setBacklogPatches((prev) => reconcileBacklogPatches(prev, liveBacklog));
  }, [liveArticleReviews, liveSectionReviews, liveBacklog]);

  // TTL sweep — only runs while patches exist so an idle screen doesn't
  // burn a 1Hz timer.
  useEffect(() => {
    if (reviewPatches.length === 0 && backlogPatches.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setReviewPatches((prev) => dropExpiredPatches(prev, now));
      setBacklogPatches((prev) => dropExpiredPatches(prev, now));
    }, 1000);
    return () => clearInterval(id);
  }, [reviewPatches.length, backlogPatches.length]);

  const articleReviewRows = useMemo(
    () =>
      applyReviewPatches(
        'articleReviews',
        liveArticleReviews,
        reviewPatches,
        articleReviewKey,
      ),
    [liveArticleReviews, reviewPatches],
  );
  const sectionReviewRows = useMemo(
    () =>
      applyReviewPatches(
        'sectionReviews',
        liveSectionReviews,
        reviewPatches,
        sectionReviewKey,
      ),
    [liveSectionReviews, reviewPatches],
  );
  const backlogRows = useMemo(
    () => applyBacklogPatches(liveBacklog, backlogPatches),
    [liveBacklog, backlogPatches],
  );

  const articleReviewByKey = useMemo(() => {
    const out: Record<string, ArticleReviewRecord> = {};
    for (const r of articleReviewRows) if (r.articleKey) out[r.articleKey] = r;
    return out;
  }, [articleReviewRows]);
  const sectionReviewByKey = useMemo(() => {
    const out: Record<string, SectionReviewRecord> = {};
    for (const r of sectionReviewRows) if (r.sectionKey) out[r.sectionKey] = r;
    return out;
  }, [sectionReviewRows]);
  const backlogByKey = useMemo(() => {
    const out: Record<string, ArticleBacklogRecord> = {};
    for (const r of backlogRows) if (r.articleKey) out[r.articleKey] = r;
    return out;
  }, [backlogRows]);

  const articleReviewStatus = useCallback(
    (articleKey: string): ReviewStatus | undefined => {
      const row = articleReviewByKey[articleKey];
      if (!row) return undefined;
      return row.status === 'approved' || row.status === 'rejected'
        ? row.status
        : undefined;
    },
    [articleReviewByKey],
  );
  const sectionReviewStatus = useCallback(
    (sectionKey: string): ReviewStatus | undefined => {
      const row = sectionReviewByKey[sectionKey];
      if (!row) return undefined;
      return row.status === 'approved' || row.status === 'rejected'
        ? row.status
        : undefined;
    },
    [sectionReviewByKey],
  );
  const backlogRow = useCallback(
    (articleKey: string): ArticleBacklogRecord | undefined => backlogByKey[articleKey],
    [backlogByKey],
  );

  // ----- Action helpers -----

  // Roll back the patches we added at `now` for these keys, used when a
  // server action throws so the UI doesn't show a stuck optimistic
  // override.
  const rollbackReviewPatches = useCallback(
    (
      collection: 'articleReviews' | 'sectionReviews',
      keys: string[],
      appliedAt: number,
    ) => {
      const set = new Set(keys);
      setReviewPatches((prev) =>
        prev.filter(
          (p) =>
            !(p.appliedAt === appliedAt && p.collection === collection && set.has(p.key)),
        ),
      );
    },
    [],
  );
  const rollbackBacklogPatches = useCallback((keys: string[], appliedAt: number) => {
    const set = new Set(keys);
    setBacklogPatches((prev) =>
      prev.filter((p) => !(p.appliedAt === appliedAt && set.has(p.key))),
    );
  }, []);

  // ----- Actions -----

  const approveArticles = useCallback<ApprovalActions['approveArticles']>(
    async (pairs) => {
      if (pairs.length === 0) return;
      const now = Date.now();
      const filtered = pairs.filter((p) => p.articleKey);
      if (filtered.length === 0) return;
      const keys = filtered.map((p) => p.articleKey);
      setReviewPatches((prev) => [
        ...prev,
        ...filtered.map<ReviewPatch>((p) => ({
          collection: 'articleReviews',
          key: p.articleKey,
          override: 'approved',
          appliedAt: now,
        })),
      ]);
      setBacklogPatches((prev) => [
        ...prev,
        ...filtered.map<BacklogPatch>((p) => ({
          key: p.articleKey,
          override: { type: 'new' },
          appliedAt: now,
        })),
      ]);
      try {
        await bulkApproveArticleReviews(slug, filtered);
        // Server-rendered surfaces (other planning tabs) read this
        // state at SSR time, so without a refresh the Next.js client
        // router cache would serve a pre-action snapshot on the next
        // navigation. The server action revalidates the path; this
        // makes the current tab eagerly re-fetch too.
        router.refresh();
      } catch (e) {
        rollbackReviewPatches('articleReviews', keys, now);
        rollbackBacklogPatches(keys, now);
        throw e;
      }
    },
    [slug, router, rollbackReviewPatches, rollbackBacklogPatches],
  );

  const unapproveArticles = useCallback<ApprovalActions['unapproveArticles']>(
    async (pairs) => {
      if (pairs.length === 0) return;
      const now = Date.now();
      const filtered = pairs.filter((p) => p.articleKey);
      if (filtered.length === 0) return;
      const keys = filtered.map((p) => p.articleKey);
      setReviewPatches((prev) => [
        ...prev,
        ...filtered.map<ReviewPatch>((p) => ({
          collection: 'articleReviews',
          key: p.articleKey,
          override: null,
          appliedAt: now,
        })),
      ]);
      setBacklogPatches((prev) => [
        ...prev,
        ...filtered.map<BacklogPatch>((p) => ({
          key: p.articleKey,
          override: null,
          appliedAt: now,
        })),
      ]);
      try {
        await bulkUnapproveArticleReviews(
          slug,
          filtered.map((p) => ({ articleKey: p.articleKey })),
        );
        router.refresh();
      } catch (e) {
        rollbackReviewPatches('articleReviews', keys, now);
        rollbackBacklogPatches(keys, now);
        throw e;
      }
    },
    [slug, router, rollbackReviewPatches, rollbackBacklogPatches],
  );

  const approveSections = useCallback<ApprovalActions['approveSections']>(
    async (pairs) => {
      if (pairs.length === 0) return;
      const now = Date.now();
      const filtered = pairs.filter((p) => p.sectionKey);
      if (filtered.length === 0) return;
      const keys = filtered.map((p) => p.sectionKey);
      setReviewPatches((prev) => [
        ...prev,
        ...filtered.map<ReviewPatch>((p) => ({
          collection: 'sectionReviews',
          key: p.sectionKey,
          override: 'approved',
          appliedAt: now,
        })),
      ]);
      // No backlog patch on section approve: the parent backlog row's
      // articleKey is derived server-side from the sectionRecordId, so
      // we'd need a round-trip to know it. The server action creates the
      // `upd::*` row and PB realtime delivers the CREATE event to all
      // hook instances.
      try {
        await bulkApproveSectionReviews(slug, filtered);
        router.refresh();
      } catch (e) {
        rollbackReviewPatches('sectionReviews', keys, now);
        throw e;
      }
    },
    [slug, router, rollbackReviewPatches],
  );

  const unapproveSections = useCallback<ApprovalActions['unapproveSections']>(
    async (pairs) => {
      if (pairs.length === 0) return;
      const now = Date.now();
      const filtered = pairs.filter((p) => p.sectionKey);
      if (filtered.length === 0) return;
      const keys = filtered.map((p) => p.sectionKey);
      setReviewPatches((prev) => [
        ...prev,
        ...filtered.map<ReviewPatch>((p) => ({
          collection: 'sectionReviews',
          key: p.sectionKey,
          override: null,
          appliedAt: now,
        })),
      ]);
      try {
        await bulkUnapproveSectionReviews(slug, filtered);
        router.refresh();
      } catch (e) {
        rollbackReviewPatches('sectionReviews', keys, now);
        throw e;
      }
    },
    [slug, router, rollbackReviewPatches],
  );

  const decideArticle = useCallback<ApprovalActions['decideArticle']>(
    async (articleKey, articleRecordId, status, notes) => {
      if (!articleKey) return;
      const now = Date.now();
      setReviewPatches((prev) => [
        ...prev,
        {
          collection: 'articleReviews',
          key: articleKey,
          override: status,
          appliedAt: now,
        },
      ]);
      // For approve: ensure backlog row optimistically. For reject /
      // reset: tombstone backlog (matches server-side behaviour).
      setBacklogPatches((prev) => [
        ...prev,
        {
          key: articleKey,
          override: status === 'approved' ? { type: 'new' } : null,
          appliedAt: now,
        },
      ]);
      try {
        if (status === null) {
          await resetArticleReview(slug, articleKey);
        } else {
          await submitArticleReview(slug, articleKey, articleRecordId, status, notes);
        }
        router.refresh();
      } catch (e) {
        rollbackReviewPatches('articleReviews', [articleKey], now);
        rollbackBacklogPatches([articleKey], now);
        throw e;
      }
    },
    [slug, router, rollbackReviewPatches, rollbackBacklogPatches],
  );

  const decideSection = useCallback<ApprovalActions['decideSection']>(
    async (sectionKey, sectionRecordId, status, notes) => {
      if (!sectionKey) return;
      const now = Date.now();
      setReviewPatches((prev) => [
        ...prev,
        {
          collection: 'sectionReviews',
          key: sectionKey,
          override: status,
          appliedAt: now,
        },
      ]);
      // No backlog patch here — the parent `upd::*` key isn't known
      // client-side. Server action handles backlog upsert/teardown; PB
      // realtime carries the result.
      try {
        if (status === null) {
          await resetSectionReview(slug, sectionKey, sectionRecordId);
        } else {
          await submitSectionReview(slug, sectionKey, sectionRecordId, status, notes);
        }
        router.refresh();
      } catch (e) {
        rollbackReviewPatches('sectionReviews', [sectionKey], now);
        throw e;
      }
    },
    [slug, router, rollbackReviewPatches],
  );

  const clearBacklog = useCallback<ApprovalActions['clearBacklog']>(
    async (articleKey) => {
      if (!articleKey) return;
      const now = Date.now();
      // Tombstone the backlog row immediately. For 'new::' keys also
      // tombstone the matching articleReview; for 'upd::' keys we don't
      // know the section keys yet and rely on PB realtime to deliver
      // the section DELETE events.
      setBacklogPatches((prev) => [
        ...prev,
        { key: articleKey, override: null, appliedAt: now },
      ]);
      if (!articleKey.startsWith('upd::')) {
        setReviewPatches((prev) => [
          ...prev,
          {
            collection: 'articleReviews',
            key: articleKey,
            override: null,
            appliedAt: now,
          },
        ]);
      }
      try {
        const result = await clearBacklogRow(slug, articleKey);
        // Now we know which sections were torn down — tombstone them so
        // the Sections / Consolidation Review tabs (which share this
        // hook in their own page instances via PB realtime) hide the
        // green tint until realtime delivers the DELETE events.
        if (articleKey.startsWith('upd::') && result.sectionReviewKeys.length > 0) {
          const t = Date.now();
          setReviewPatches((prev) => [
            ...prev,
            ...result.sectionReviewKeys.map<ReviewPatch>((k) => ({
              collection: 'sectionReviews',
              key: k,
              override: null,
              appliedAt: t,
            })),
          ]);
        }
        router.refresh();
      } catch (e) {
        if (!articleKey.startsWith('upd::')) {
          rollbackReviewPatches('articleReviews', [articleKey], now);
        }
        rollbackBacklogPatches([articleKey], now);
        throw e;
      }
    },
    [slug, router, rollbackReviewPatches, rollbackBacklogPatches],
  );

  return useMemo(
    () => ({
      articleReviewRows,
      sectionReviewRows,
      backlogRows,
      articleReviewByKey,
      sectionReviewByKey,
      backlogByKey,
      articleReviewStatus,
      sectionReviewStatus,
      backlogRow,
      approveArticles,
      unapproveArticles,
      approveSections,
      unapproveSections,
      decideArticle,
      decideSection,
      clearBacklog,
    }),
    [
      articleReviewRows,
      sectionReviewRows,
      backlogRows,
      articleReviewByKey,
      sectionReviewByKey,
      backlogByKey,
      articleReviewStatus,
      sectionReviewStatus,
      backlogRow,
      approveArticles,
      unapproveArticles,
      approveSections,
      unapproveSections,
      decideArticle,
      decideSection,
      clearBacklog,
    ],
  );
}

export { APPROVAL_PATCH_TTL_MS } from './approval-patches';
