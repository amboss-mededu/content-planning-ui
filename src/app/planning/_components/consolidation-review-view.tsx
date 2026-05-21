'use client';

import { Badge, Button, Inline, Notification, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ArticleReviewRecord,
  ReviewCommentRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';
import { useApprovalState } from '@/lib/pb/use-approval-state';
import {
  deriveReviewCategories,
  getConsolidationActionLabel,
} from '@/lib/workflows/consolidation/buckets';
import {
  ArticleManagerModalV2,
  type ReviewerMap,
  type ReviewMap,
  type ReviewStatus,
} from './article-manager-modal-v2';
import type { ArticleRow } from './articles-view';
import { CategoryGroupedCodeList, CodeChipList } from './code-chip';
import type { CategoryLookup, TitleOriginLookup } from './code-utils';
import { ConsolidationProgressBadge } from './consolidation-progress-badge';
import { ConsolidationViewSwitcher } from './consolidation-view-switcher';
import { RerunConfirmModal } from './rerun-confirm-modal';
import type { SectionRow } from './sections-view';
import {
  type ConsolidationRerunOptions,
  useConsolidationRerun,
} from './use-consolidation-rerun';
import {
  type PipelineRunSettlement,
  useRerunningCategories,
} from './use-rerunning-categories';

type CategoryBucket = {
  articles: ArticleRow[];
  sections: SectionRow[];
};

const UNCATEGORIZED = '(uncategorized)';

// Switch from per-code chips to category-grouped chips once a row's code
// count makes the flat list too dense to scan. Editors hover a group chip
// to see the per-code metadata table.
const GROUPED_CODES_THRESHOLD = 15;

// Tints reused from the New Articles / Article Updates tables so a row's
// approval state reads identically across screens.
const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';
const ZEBRA_TINT = 'rgba(0, 0, 0, 0.025)';

function settlementErrorMessage(settlement: PipelineRunSettlement): string | null {
  if (settlement.status !== 'failed' && settlement.status !== 'cancelled') return null;
  const categories = settlement.categories.join(', ');
  const action = settlement.status === 'cancelled' ? 'cancelled' : 'failed';
  return `Consolidation ${action} for "${categories}": ${
    settlement.error ?? `run ${settlement.runId}`
  }`;
}

type ModalOpener =
  | { kind: 'article'; startAtId: string }
  | { kind: 'section'; startAtId: string }
  | null;

export function ConsolidationReviewView({
  slug,
  initialCategory,
  articles,
  sections,
  mappingByCategory,
  categoryLookup,
  titleOriginLookup,
  initialArticleReviews,
  initialArticleReviewers,
  initialArticleReviewRows,
  initialSectionReviews,
  initialSectionReviewers,
  initialSectionReviewRows,
  initialNotesByArticle,
  initialNotesBySection,
  initialCommentsByArticle,
  initialCommentsBySection,
  initialCommentsByParentArticle,
  viewerEmail,
}: {
  slug: string;
  /** Initial category from the URL (`?category=...`), read on the
   *  server. Subsequent selection updates are tracked locally and
   *  written via `window.history.replaceState` — we deliberately avoid
   *  `useSearchParams()` here because Cache Components mode raises
   *  brittle SSR errors on client components that read dynamic params
   *  without their own Suspense boundary. */
  initialCategory: string | null;
  articles: ArticleRow[];
  sections: SectionRow[];
  /** Per-category mapping snapshot, computed once on the server from the
   *  `codes` collection. Drives the readiness chip next to each rail item.
   *  `ready` flips true once every code in the category has `mappedAt`
   *  set, which is the precondition for the (still-to-be-built) per-
   *  category consolidation trigger. */
  mappingByCategory: Record<string, { mapped: number; total: number; ready: boolean }>;
  categoryLookup: CategoryLookup;
  titleOriginLookup: TitleOriginLookup;
  initialArticleReviews: ReviewMap;
  initialArticleReviewers: ReviewerMap;
  initialArticleReviewRows: ArticleReviewRecord[];
  initialSectionReviews: ReviewMap;
  initialSectionReviewers: ReviewerMap;
  initialSectionReviewRows: SectionReviewRecord[];
  initialNotesByArticle: Record<string, string>;
  initialNotesBySection: Record<string, string>;
  initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
  initialCommentsBySection: Record<string, ReviewCommentRecord[]>;
  initialCommentsByParentArticle: Record<string, ReviewCommentRecord[]>;
  viewerEmail?: string;
}) {
  // Single source of truth for review + backlog state across all four
  // planning screens. Reads live PB subscriptions, applies optimistic
  // patches, and exposes action methods that update both immediately and
  // via the server-action result.
  const approval = useApprovalState(slug, {
    articleReviews: initialArticleReviewRows,
    sectionReviews: initialSectionReviewRows,
  });
  // ReviewMaps derived from the hook's effective state. Kept as
  // useMemo'd derivations so the rest of this component (and the modal
  // props) keep their existing shape.
  const articleReviews = useMemo<ReviewMap>(() => {
    const out: ReviewMap = {};
    for (const r of approval.articleReviewRows) {
      if (r.articleKey) out[r.articleKey] = r.status;
    }
    return out;
  }, [approval.articleReviewRows]);
  const articleReviewers = useMemo<ReviewerMap>(() => {
    const out: ReviewerMap = {};
    for (const r of approval.articleReviewRows) {
      if (!r.articleKey) continue;
      out[r.articleKey] = {
        reviewerEmail: r.reviewerEmail,
        reviewedAt: r.reviewedAt,
      };
    }
    return out;
  }, [approval.articleReviewRows]);
  const sectionReviews = useMemo<ReviewMap>(() => {
    const out: ReviewMap = {};
    for (const r of approval.sectionReviewRows) {
      if (r.sectionKey) out[r.sectionKey] = r.status;
    }
    return out;
  }, [approval.sectionReviewRows]);
  const sectionReviewers = useMemo<ReviewerMap>(() => {
    const out: ReviewerMap = {};
    for (const r of approval.sectionReviewRows) {
      if (!r.sectionKey) continue;
      out[r.sectionKey] = {
        reviewerEmail: r.reviewerEmail,
        reviewedAt: r.reviewedAt,
      };
    }
    return out;
  }, [approval.sectionReviewRows]);
  // SSR snapshots are no longer needed at runtime once the hook is
  // seeded, but the props stay in the signature so the loader page
  // doesn't have to change shape. Silence unused-var warnings.
  void initialArticleReviews;
  void initialArticleReviewers;
  void initialSectionReviews;
  void initialSectionReviewers;
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalOpener>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settledRunError, setSettledRunError] = useState<string | null>(null);
  const router = useRouter();
  // Per-category rerun is shared with the Category modal via this hook —
  // both surfaces honor the same in-flight set, confirm dialog, and
  // router refresh on success.
  const {
    rerun: startConsolidation,
    isRunning: isLocalCategoryRunning,
    lastResult: lastRerunResult,
    dismissLastResult: dismissLastRerunResult,
    error: perCategoryError,
    dismissError: dismissPerCategoryError,
  } = useConsolidationRerun(slug);
  // Cross-tab live signal: any pipelineRuns row with status=running and
  // targetCategories containing this bucket. Merged with the local
  // in-flight set so the rail badge flips instantly on click (before PB
  // realtime delivers the create event) and lingers until the server-side
  // row flips out of "running" status.
  const refreshOnSettled = useCallback(
    (settlement: PipelineRunSettlement) => {
      const message = settlementErrorMessage(settlement);
      if (message) setSettledRunError(message);
      router.refresh();
    },
    [router],
  );
  const rebuildingCategories = useRerunningCategories(slug, {
    onSettled: refreshOnSettled,
  });
  const isCategoryConsolidating = useCallback(
    (cat: string) => isLocalCategoryRunning(cat) || rebuildingCategories.has(cat),
    [isLocalCategoryRunning, rebuildingCategories],
  );
  const consolidateError = perCategoryError ?? settledRunError ?? actionError;
  const dismissConsolidateError = useCallback(() => {
    dismissPerCategoryError();
    setSettledRunError(null);
    setActionError(null);
  }, [dismissPerCategoryError]);

  // Group rows by category. Both 1st-pass collections carry a `category`
  // string; rows missing one bucket under "(uncategorized)" so they're
  // still reviewable from this screen.
  const grouped = useMemo<Map<string, CategoryBucket>>(() => {
    const m = new Map<string, CategoryBucket>();
    function bucket(cat: string): CategoryBucket {
      let b = m.get(cat);
      if (!b) {
        b = { articles: [], sections: [] };
        m.set(cat, b);
      }
      return b;
    }
    for (const a of articles) {
      if (!a.id) continue;
      bucket(a.category ?? UNCATEGORIZED).articles.push(a);
    }
    for (const s of sections) {
      if (!s.id) continue;
      bucket(s.category ?? UNCATEGORIZED).sections.push(s);
    }
    return m;
  }, [articles, sections]);

  // Rail categories are keyed by codes.consolidationCategory. Existing
  // output is only detail for those buckets; it is not the source of
  // truth for the rail, so a ready bucket that produced zero rows stays visible.
  const categories = useMemo(
    () => deriveReviewCategories(mappingByCategory),
    [mappingByCategory],
  );

  // Specialty-level "any mapping at all?" — controls whether the
  // run-all button at the top of the rail is shown. If no codes are
  // mapped yet, the user belongs back on the codes screen first.
  const hasAnyMapping = useMemo(
    () => Object.values(mappingByCategory).some((m) => m.mapped > 0),
    [mappingByCategory],
  );

  const [selectedCategoryRaw, setSelectedCategoryRaw] = useState<string | null>(
    initialCategory,
  );
  // Resolve to the first category if the URL value doesn't exist (yet) in
  // `grouped` — e.g. on hard reload of a stale URL after a re-run.
  const selectedCategory = useMemo(() => {
    if (selectedCategoryRaw && categories.includes(selectedCategoryRaw)) {
      return selectedCategoryRaw;
    }
    return categories[0] ?? null;
  }, [selectedCategoryRaw, categories]);

  // Sync URL ← selectedCategory without triggering navigation. Same
  // pattern as articles-view.tsx — keeps the URL bookmarkable while
  // avoiding `router.replace` (which under Cache Components triggers an
  // RSC fetch and re-renders the server tree).
  useEffect(() => {
    if (typeof window === 'undefined' || !selectedCategory) return;
    const next = new URLSearchParams(window.location.search);
    if (next.get('category') === selectedCategory) return;
    next.set('category', selectedCategory);
    const url = `${window.location.pathname}?${next.toString()}`;
    window.history.replaceState(null, '', url);
  }, [selectedCategory]);

  const selectCategory = useCallback((cat: string) => {
    setSelectedCategoryRaw(cat);
    setSelectedArticleIds(new Set());
    setSelectedSectionIds(new Set());
  }, []);

  // A mapping-ready but never-consolidated category has no entry in
  // `grouped`. Fall back to an empty bucket so the right pane still
  // renders (the sub-tables show their empty states) and the user has
  // a "Start consolidation" target in the rail to click.
  const selectedBucket = useMemo(() => {
    if (!selectedCategory) return undefined;
    return grouped.get(selectedCategory) ?? { articles: [], sections: [] };
  }, [selectedCategory, grouped]);

  // ----- Per-category aggregate counts (drives left-rail badges) -----
  const counts = useMemo(() => {
    const out: Record<
      string,
      { articleApproved: number; sectionApproved: number; total: number }
    > = {};
    for (const [cat, bucket] of grouped.entries()) {
      let articleApproved = 0;
      let sectionApproved = 0;
      for (const a of bucket.articles) {
        if (a.articleKey && articleReviews[a.articleKey] === 'approved')
          articleApproved++;
      }
      for (const s of bucket.sections) {
        if (s.sectionKey && sectionReviews[s.sectionKey] === 'approved')
          sectionApproved++;
      }
      out[cat] = {
        articleApproved,
        sectionApproved,
        total: bucket.articles.length + bucket.sections.length,
      };
    }
    return out;
  }, [grouped, articleReviews, sectionReviews]);

  // ----- Bulk approvals -----
  // All approve/unapprove paths flow through the shared hook, which
  // applies optimistic patches immediately and reconciles via the
  // server-action result. The hook owns retries/error handling — these
  // wrappers just shape inputs.

  // Surface server-action failures in the rail's error chip; without
  // this the optimistic patch silently rolls back and the user sees
  // their click "undo itself" with no explanation.
  const surfaceActionError = useCallback(
    (e: unknown) =>
      setActionError(
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'Action failed',
      ),
    [],
  );

  const approveAndBacklogArticles = useCallback(
    (pairs: Array<{ articleKey: string; articleRecordId: string }>) => {
      approval.approveArticles(pairs).catch(surfaceActionError);
    },
    [approval, surfaceActionError],
  );

  const approveAndBacklogSections = useCallback(
    (pairs: Array<{ sectionKey: string; sectionRecordId: string }>) => {
      approval.approveSections(pairs).catch(surfaceActionError);
    },
    [approval, surfaceActionError],
  );

  const unapproveArticles = useCallback(
    (pairs: Array<{ articleKey: string; articleRecordId: string }>) => {
      approval.unapproveArticles(pairs).catch(surfaceActionError);
    },
    [approval, surfaceActionError],
  );

  const unapproveSections = useCallback(
    (pairs: Array<{ sectionKey: string; sectionRecordId: string }>) => {
      approval.unapproveSections(pairs).catch(surfaceActionError);
    },
    [approval, surfaceActionError],
  );

  // Modal calls these to persist a single article / section decision
  // through the hook (optimistic patches + server action + rollback on
  // failure). Errors propagate so the modal can roll back its own
  // snapshot.
  const decideArticleFromModal = approval.decideArticle;
  const decideSectionFromModal = approval.decideSection;

  const approveAllInCategory = useCallback(() => {
    if (!selectedBucket) return;
    const articlePairs = selectedBucket.articles
      .filter((a) => a.articleKey && a.id && articleReviews[a.articleKey] !== 'approved')
      .map((a) => ({
        articleKey: a.articleKey as string,
        articleRecordId: a.id as string,
      }));
    const sectionPairs = selectedBucket.sections
      .filter((s) => s.sectionKey && s.id && sectionReviews[s.sectionKey] !== 'approved')
      .map((s) => ({
        sectionKey: s.sectionKey as string,
        sectionRecordId: s.id as string,
      }));
    approveAndBacklogArticles(articlePairs);
    approveAndBacklogSections(sectionPairs);
    setSelectedArticleIds(new Set());
    setSelectedSectionIds(new Set());
  }, [
    selectedBucket,
    articleReviews,
    sectionReviews,
    approveAndBacklogArticles,
    approveAndBacklogSections,
  ]);

  // ----- Specialty-level consolidation trigger -----
  // Omitting `categories` runs primary for every mapped category in
  // the specialty. The same endpoint handles both bootstrap (no
  // output yet) and re-run scenarios. `chainSecondaries: true` so
  // one click produces end-to-end output.
  const startConsolidationAll = useCallback(async () => {
    if (isRunningAll) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        hasAnyMapping
          ? 'Run consolidation for all categories? This will reset current consolidation output where it exists.'
          : 'Run consolidation for all categories?',
      )
    ) {
      return;
    }
    setActionError(null);
    setIsRunningAll(true);
    try {
      const res = await fetch('/api/workflows/consolidate-primary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug: slug,
          chainSecondaries: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body?.error ?? `HTTP ${res.status} starting consolidation`);
        return;
      }
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunningAll(false);
    }
  }, [slug, router, isRunningAll, hasAnyMapping]);

  // ----- Reset approvals -----
  const [isResetting, setIsResetting] = useState(false);
  const resetApprovals = useCallback(async () => {
    if (isResetting) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Reset approvals for this specialty? This removes all approvals, backlog assignments, sources, and writing drafts. The mapping and 1st consolidation are preserved.',
      )
    ) {
      return;
    }
    setActionError(null);
    setIsResetting(true);
    try {
      const res = await fetch('/api/workflows/reset-approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug: slug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body?.error ?? `HTTP ${res.status} resetting approvals`);
        return;
      }
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsResetting(false);
    }
  }, [slug, router, isResetting]);

  // ----- Modal close -----
  const closeModal = useCallback(() => setModal(null), []);

  // Per-category rerun confirm flow. Holds the pending category +
  // hasOutput so the amboss confirm modal can show the right copy and
  // (for re-runs) collect an optional editor note that gets appended
  // to the LLM user message.
  const [pendingRerun, setPendingRerun] = useState<{
    category: string;
    hasOutput: boolean;
  } | null>(null);
  const requestConsolidation = useCallback(
    (cat: string, options?: ConsolidationRerunOptions) => {
      const hasOutput = options?.hasOutput ?? true;
      setPendingRerun({ category: cat, hasOutput });
    },
    [],
  );

  return (
    <Stack space="m">
      <ConsolidationViewSwitcher slug={slug} />
      {/* Use a plain CSS grid (not the DS `Inline`) for the rail/content
       *  split. `Inline` wraps by default, so a wide right-pane could
       *  wrap below the rail invisibly — what we hit before. Grid keeps
       *  the two-column layout deterministic regardless of content
       *  width, and the right column gets a `minmax(0, 1fr)` so any
       *  oversized child (a long code chip row, the codes column) is
       *  clipped instead of pushing the layout. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <CategoryRail
          categories={categories}
          counts={counts}
          mappingByCategory={mappingByCategory}
          hasAnyMapping={hasAnyMapping}
          selectedCategory={selectedCategory}
          onSelect={selectCategory}
          isCategoryConsolidating={isCategoryConsolidating}
          onStartConsolidation={requestConsolidation}
          isRunningAll={isRunningAll}
          onStartConsolidationAll={startConsolidationAll}
          onResetApprovals={resetApprovals}
          isResetting={isResetting}
          consolidateError={consolidateError}
          onDismissError={dismissConsolidateError}
          lastResult={lastRerunResult}
          onDismissLastResult={dismissLastRerunResult}
        />
        <div style={{ minWidth: 0 }}>
          {selectedCategory && selectedBucket ? (
            <CategoryDetailPane
              category={selectedCategory}
              bucket={selectedBucket}
              articleReviews={articleReviews}
              articleReviewers={articleReviewers}
              sectionReviews={sectionReviews}
              sectionReviewers={sectionReviewers}
              selectedArticleIds={selectedArticleIds}
              setSelectedArticleIds={setSelectedArticleIds}
              selectedSectionIds={selectedSectionIds}
              setSelectedSectionIds={setSelectedSectionIds}
              categoryLookup={categoryLookup}
              onApproveSelectedArticles={() => {
                if (!selectedBucket) return;
                const pairs = selectedBucket.articles
                  .filter(
                    (a) =>
                      a.id &&
                      a.articleKey &&
                      selectedArticleIds.has(a.id) &&
                      articleReviews[a.articleKey] !== 'approved',
                  )
                  .map((a) => ({
                    articleKey: a.articleKey as string,
                    articleRecordId: a.id as string,
                  }));
                approveAndBacklogArticles(pairs);
                setSelectedArticleIds(new Set());
              }}
              onApproveSelectedSections={() => {
                if (!selectedBucket) return;
                const pairs = selectedBucket.sections
                  .filter(
                    (s) =>
                      s.id &&
                      s.sectionKey &&
                      selectedSectionIds.has(s.id) &&
                      sectionReviews[s.sectionKey] !== 'approved',
                  )
                  .map((s) => ({
                    sectionKey: s.sectionKey as string,
                    sectionRecordId: s.id as string,
                  }));
                approveAndBacklogSections(pairs);
                setSelectedSectionIds(new Set());
              }}
              onUnapproveSelectedArticles={() => {
                if (!selectedBucket) return;
                const pairs = selectedBucket.articles
                  .filter(
                    (a) =>
                      a.id &&
                      a.articleKey &&
                      selectedArticleIds.has(a.id) &&
                      articleReviews[a.articleKey] === 'approved',
                  )
                  .map((a) => ({
                    articleKey: a.articleKey as string,
                    articleRecordId: a.id as string,
                  }));
                unapproveArticles(pairs);
                setSelectedArticleIds(new Set());
              }}
              onUnapproveSelectedSections={() => {
                if (!selectedBucket) return;
                const pairs = selectedBucket.sections
                  .filter(
                    (s) =>
                      s.id &&
                      s.sectionKey &&
                      selectedSectionIds.has(s.id) &&
                      sectionReviews[s.sectionKey] === 'approved',
                  )
                  .map((s) => ({
                    sectionKey: s.sectionKey as string,
                    sectionRecordId: s.id as string,
                  }));
                unapproveSections(pairs);
                setSelectedSectionIds(new Set());
              }}
              onDecideArticle={(id, status) => {
                if (!selectedBucket) return;
                const a = selectedBucket.articles.find((x) => x.id === id);
                if (!a?.id || !a.articleKey) return;
                approval
                  .decideArticle(a.articleKey, a.id, status)
                  .catch(surfaceActionError);
              }}
              onDecideSection={(id, status) => {
                if (!selectedBucket) return;
                const s = selectedBucket.sections.find((x) => x.id === id);
                if (!s?.id || !s.sectionKey) return;
                approval
                  .decideSection(s.sectionKey, s.id, status)
                  .catch(surfaceActionError);
              }}
              onApproveAll={approveAllInCategory}
              onStartConsolidation={requestConsolidation}
              isConsolidating={isCategoryConsolidating(selectedCategory)}
              hasOutput={
                selectedBucket.articles.length + selectedBucket.sections.length > 0
              }
              onRowClickArticle={(id) => setModal({ kind: 'article', startAtId: id })}
              onRowClickSection={(id) => setModal({ kind: 'section', startAtId: id })}
            />
          ) : (
            <Text color="secondary">
              {articles.length + sections.length === 0
                ? 'No consolidation output yet for this specialty. Use "Run consolidation for all categories" in the rail to start.'
                : 'Select a category from the left to start reviewing.'}
            </Text>
          )}
        </div>
      </div>

      {modal?.kind === 'article' && selectedBucket && (
        <ArticleManagerModalV2
          opener={{
            type: 'new',
            stage: 'review-1st',
            slug,
            articles: selectedBucket.articles,
            passLabel: 'Consolidation review',
            startAtId: modal.startAtId,
            initialReviews: articleReviews,
            initialReviewers: articleReviewers,
            initialCommentsByArticle,
            initialNotesByArticle,
            categoryLookup,
            titleOriginLookup,
            viewerEmail,
            onDecideArticle: decideArticleFromModal,
          }}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'section' && selectedBucket && (
        <ArticleManagerModalV2
          opener={{
            type: 'update',
            stage: 'review-1st',
            slug,
            sections: selectedBucket.sections,
            startAtId: modal.startAtId,
            initialReviews: sectionReviews,
            initialReviewers: sectionReviewers,
            initialCommentsBySection,
            initialCommentsByParentArticle,
            initialNotesBySection,
            categoryLookup,
            titleOriginLookup,
            viewerEmail,
            onDecideSection: decideSectionFromModal,
          }}
          onClose={closeModal}
        />
      )}
      <RerunConfirmModal
        open={!!pendingRerun}
        category={pendingRerun?.category ?? ''}
        hasOutput={pendingRerun?.hasOutput ?? false}
        onCancel={() => setPendingRerun(null)}
        onConfirm={(editorNote) => {
          const next = pendingRerun;
          setPendingRerun(null);
          if (!next) return;
          void startConsolidation(next.category, {
            hasOutput: next.hasOutput,
            editorNote,
          });
        }}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Left rail — list of categories with progress badges
// ---------------------------------------------------------------------------

function CategoryRail({
  categories,
  counts,
  mappingByCategory,
  hasAnyMapping,
  selectedCategory,
  onSelect,
  isCategoryConsolidating,
  onStartConsolidation,
  isRunningAll,
  onStartConsolidationAll,
  onResetApprovals,
  isResetting,
  consolidateError,
  onDismissError,
  lastResult,
  onDismissLastResult,
}: {
  categories: string[];
  counts: Record<
    string,
    { articleApproved: number; sectionApproved: number; total: number }
  >;
  mappingByCategory: Record<string, { mapped: number; total: number; ready: boolean }>;
  hasAnyMapping: boolean;
  selectedCategory: string | null;
  onSelect: (cat: string) => void;
  isCategoryConsolidating: (cat: string) => boolean;
  onStartConsolidation: (cat: string, options?: ConsolidationRerunOptions) => void;
  isRunningAll: boolean;
  onStartConsolidationAll: () => void;
  onResetApprovals: () => void;
  isResetting: boolean;
  consolidateError: string | null;
  onDismissError: () => void;
  lastResult: {
    category: string;
    consolidatedArticles: number;
    consolidatedSections: number;
  } | null;
  onDismissLastResult: () => void;
}) {
  const hasOutput = Object.values(counts).some((c) => c.total > 0);
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        borderRight: '1px solid rgb(228, 228, 234)',
        paddingRight: 8,
        position: 'sticky',
        top: 16,
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
      }}
    >
      <Stack space="xs">
        {consolidateError ? (
          <Notification
            type="error"
            text={consolidateError}
            isDismissable
            closeButtonAriaLabel="Dismiss consolidation error"
            onClickDismiss={onDismissError}
          />
        ) : null}
        {lastResult ? (
          <button
            type="button"
            onClick={onDismissLastResult}
            style={{
              textAlign: 'left',
              padding: '6px 8px',
              border:
                lastResult.consolidatedArticles + lastResult.consolidatedSections > 0
                  ? '1px solid rgb(16, 185, 129)'
                  : '1px solid rgb(217, 119, 6)',
              borderRadius: 4,
              background:
                lastResult.consolidatedArticles + lastResult.consolidatedSections > 0
                  ? 'rgb(220, 252, 231)'
                  : 'rgb(255, 247, 219)',
              cursor: 'pointer',
              font: 'inherit',
              color:
                lastResult.consolidatedArticles + lastResult.consolidatedSections > 0
                  ? 'rgb(6, 95, 70)'
                  : 'rgb(120, 53, 15)',
              fontSize: 12,
            }}
            title="Dismiss"
          >
            Updated · {lastResult.consolidatedArticles} article
            {lastResult.consolidatedArticles === 1 ? '' : 's'} ·{' '}
            {lastResult.consolidatedSections} section
            {lastResult.consolidatedSections === 1 ? '' : 's'}
          </button>
        ) : null}
        {hasAnyMapping ? (
          <Button
            variant={hasOutput ? 'tertiary' : 'primary'}
            fullWidth
            onClick={onStartConsolidationAll}
            disabled={isRunningAll}
          >
            {isRunningAll
              ? 'Consolidating…'
              : hasOutput
                ? 'Re-run all consolidation'
                : 'Run consolidation for all categories'}
          </Button>
        ) : null}
        {hasOutput ? (
          <Button
            variant="tertiary"
            fullWidth
            onClick={onResetApprovals}
            disabled={isResetting}
          >
            {isResetting ? 'Resetting…' : 'Reset approvals'}
          </Button>
        ) : null}
        {categories.length === 0 && (
          <Text color="secondary" size="s">
            {hasAnyMapping
              ? 'No consolidation output yet. Use the button above to start.'
              : 'Map some codes to a category first to enable consolidation.'}
          </Text>
        )}
        {categories.map((cat) => {
          const c = counts[cat] ?? { articleApproved: 0, sectionApproved: 0, total: 0 };
          const approved = c.articleApproved + c.sectionApproved;
          const isActive = cat === selectedCategory;
          const allApproved = c.total > 0 && approved === c.total;
          const itemStyle: CSSProperties = {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 4,
            padding: '8px 10px',
            border: '1px solid',
            borderColor: isActive ? 'rgb(217, 119, 6)' : 'rgb(228, 228, 234)',
            borderRadius: 6,
            background: isActive ? 'rgb(255, 247, 235)' : 'white',
            cursor: 'pointer',
            font: 'inherit',
            textAlign: 'left',
            width: '100%',
          };
          const mapping = mappingByCategory[cat];
          const isConsolidating = isCategoryConsolidating(cat);
          const hasOutput = c.total > 0;
          // Two siblings inside a plain non-interactive container:
          //   1) the category-select button (label + status badges)
          //   2) an optional Start-consolidation button
          // Avoids nested <button> (invalid HTML) and the bubbling-onClick
          // workaround the linter rejected.
          const selectStyle: CSSProperties = {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 4,
            padding: 0,
            margin: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            width: '100%',
          };
          return (
            <div key={cat} style={itemStyle}>
              <button type="button" onClick={() => onSelect(cat)} style={selectStyle}>
                <Text size="s" weight={isActive ? 'bold' : 'normal'}>
                  {cat}
                </Text>
                {!isConsolidating ? (
                  <Inline space="xxs" vAlignItems="center">
                    {allApproved && <Badge text="all approved" color="green" />}
                    {!allApproved && hasOutput && (
                      <Text size="xs" color="secondary">
                        {approved}/{c.total} approved
                      </Text>
                    )}
                    {mapping && !mapping.ready ? (
                      <Text size="xs" color="secondary">
                        {mapping.mapped}/{mapping.total} mapped
                      </Text>
                    ) : null}
                  </Inline>
                ) : null}
              </button>
              {mapping?.ready ? (
                <Button
                  variant="tertiary"
                  fullWidth
                  onClick={() => onStartConsolidation(cat, { hasOutput })}
                  disabled={isConsolidating}
                >
                  {isConsolidating ? (
                    <ConsolidationProgressBadge />
                  ) : (
                    getConsolidationActionLabel({ hasOutput, isConsolidating })
                  )}
                </Button>
              ) : null}
            </div>
          );
        })}
      </Stack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right pane — sub-tables for the selected category
// ---------------------------------------------------------------------------

function CategoryDetailPane({
  category,
  bucket,
  articleReviews,
  articleReviewers: _articleReviewers,
  sectionReviews,
  sectionReviewers: _sectionReviewers,
  selectedArticleIds,
  setSelectedArticleIds,
  selectedSectionIds,
  setSelectedSectionIds,
  categoryLookup,
  onApproveSelectedArticles,
  onApproveSelectedSections,
  onUnapproveSelectedArticles,
  onUnapproveSelectedSections,
  onDecideArticle,
  onDecideSection,
  onApproveAll,
  onStartConsolidation,
  isConsolidating,
  hasOutput,
  onRowClickArticle,
  onRowClickSection,
}: {
  category: string;
  bucket: CategoryBucket;
  articleReviews: ReviewMap;
  articleReviewers: ReviewerMap;
  sectionReviews: ReviewMap;
  sectionReviewers: ReviewerMap;
  selectedArticleIds: Set<string>;
  setSelectedArticleIds: (s: Set<string>) => void;
  selectedSectionIds: Set<string>;
  setSelectedSectionIds: (s: Set<string>) => void;
  categoryLookup: CategoryLookup;
  onApproveSelectedArticles: () => void;
  onApproveSelectedSections: () => void;
  onUnapproveSelectedArticles: () => void;
  onUnapproveSelectedSections: () => void;
  onDecideArticle: (id: string, status: ReviewStatus | null) => void;
  onDecideSection: (id: string, status: ReviewStatus | null) => void;
  onApproveAll: () => void;
  onStartConsolidation: (cat: string, options?: ConsolidationRerunOptions) => void;
  isConsolidating: boolean;
  hasOutput: boolean;
  onRowClickArticle: (id: string) => void;
  onRowClickSection: (id: string) => void;
}) {
  const unapprovedCount =
    bucket.articles.filter(
      (a) => a.articleKey && articleReviews[a.articleKey] !== 'approved',
    ).length +
    bucket.sections.filter(
      (s) => s.sectionKey && sectionReviews[s.sectionKey] !== 'approved',
    ).length;

  return (
    <Stack space="m">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          {category}
        </Text>
      </Inline>

      <Inline space="xs" vAlignItems="center">
        <Button variant="primary" onClick={onApproveAll} disabled={unapprovedCount === 0}>
          {`Approve all (${unapprovedCount})`}
        </Button>
        <Button
          variant="tertiary"
          onClick={() => onStartConsolidation(category, { hasOutput })}
          disabled={isConsolidating}
        >
          {isConsolidating ? (
            <ConsolidationProgressBadge />
          ) : (
            getConsolidationActionLabel({ hasOutput, isConsolidating })
          )}
        </Button>
      </Inline>

      <ArticleSubTable
        rows={bucket.articles}
        reviews={articleReviews}
        selectedIds={selectedArticleIds}
        onToggle={(id) => {
          const next = new Set(selectedArticleIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          setSelectedArticleIds(next);
        }}
        onToggleAll={(checked) => {
          if (!checked) {
            setSelectedArticleIds(new Set());
            return;
          }
          const next = new Set<string>();
          for (const a of bucket.articles) {
            if (a.id && a.articleKey) next.add(a.id);
          }
          setSelectedArticleIds(next);
        }}
        onRowClick={onRowClickArticle}
        onApproveSelected={onApproveSelectedArticles}
        onUnapproveSelected={onUnapproveSelectedArticles}
        onDecideRow={onDecideArticle}
        categoryLookup={categoryLookup}
      />

      <SectionSubTable
        rows={bucket.sections}
        reviews={sectionReviews}
        selectedIds={selectedSectionIds}
        onToggle={(id) => {
          const next = new Set(selectedSectionIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          setSelectedSectionIds(next);
        }}
        onToggleAll={(checked) => {
          if (!checked) {
            setSelectedSectionIds(new Set());
            return;
          }
          const next = new Set<string>();
          for (const s of bucket.sections) {
            if (s.id && s.sectionKey) next.add(s.id);
          }
          setSelectedSectionIds(next);
        }}
        onRowClick={onRowClickSection}
        onApproveSelected={onApproveSelectedSections}
        onUnapproveSelected={onUnapproveSelectedSections}
        onDecideRow={onDecideSection}
        categoryLookup={categoryLookup}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Sub-tables — lightweight tables with row checkboxes
// ---------------------------------------------------------------------------

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid rgb(228, 228, 234)',
  fontWeight: 600,
  color: 'rgb(60, 60, 70)',
  background: 'rgb(248, 248, 250)',
};
const tdStyle: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid rgb(238, 238, 244)',
  verticalAlign: 'top',
};
const numTdStyle: CSSProperties = { ...tdStyle, textAlign: 'center', width: 70 };
const checkboxTdStyle: CSSProperties = { ...tdStyle, width: 36, textAlign: 'center' };
const decisionCellStyle: CSSProperties = { ...tdStyle, textAlign: 'center' };
const decisionButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 4,
  border: '1px solid rgba(0, 0, 0, 0.15)',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
};

function rowTint(status: ReviewStatus | undefined): CSSProperties | undefined {
  if (status === 'approved') return { background: APPROVED_TINT };
  if (status === 'rejected') return { background: REJECTED_TINT };
  return undefined;
}

function decisionButton(active: boolean, kind: ReviewStatus): CSSProperties {
  if (!active) return decisionButtonBase;
  if (kind === 'approved') {
    return {
      ...decisionButtonBase,
      background: 'rgb(16, 185, 129)',
      borderColor: 'rgb(16, 185, 129)',
      color: '#fff',
    };
  }
  return {
    ...decisionButtonBase,
    background: 'rgb(220, 38, 38)',
    borderColor: 'rgb(220, 38, 38)',
    color: '#fff',
  };
}

function DecisionButtons({
  status,
  disabled,
  approveTitle,
  rejectTitle,
  onDecide,
}: {
  status: ReviewStatus | undefined;
  disabled: boolean;
  approveTitle: string;
  rejectTitle: string;
  onDecide: (status: ReviewStatus | null) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <button
        type="button"
        title={status === 'approved' ? `${approveTitle} — click to clear` : approveTitle}
        style={decisionButton(status === 'approved', 'approved')}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onDecide(status === 'approved' ? null : 'approved');
        }}
      >
        ✓
      </button>
      <button
        type="button"
        title={status === 'rejected' ? `${rejectTitle} — click to clear` : rejectTitle}
        style={decisionButton(status === 'rejected', 'rejected')}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onDecide(status === 'rejected' ? null : 'rejected');
        }}
      >
        ✗
      </button>
    </div>
  );
}

function ArticleSubTable({
  rows,
  reviews,
  selectedIds,
  onToggle,
  onToggleAll,
  onRowClick,
  onApproveSelected,
  onUnapproveSelected,
  onDecideRow,
  categoryLookup,
}: {
  rows: ArticleRow[];
  reviews: ReviewMap;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onRowClick: (id: string) => void;
  onApproveSelected: () => void;
  onUnapproveSelected: () => void;
  onDecideRow: (id: string, status: ReviewStatus | null) => void;
  categoryLookup: CategoryLookup;
}) {
  const keyById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of rows) if (r.id && r.articleKey) out[r.id] = r.articleKey;
    return out;
  }, [rows]);
  const reviewableIds = rows.flatMap((r) => (r.id && r.articleKey ? [r.id] : []));
  const allReviewableChecked =
    reviewableIds.length > 0 && reviewableIds.every((id) => selectedIds.has(id));
  const selectedApprovedCount = Array.from(selectedIds).filter(
    (id) => keyById[id] && reviews[keyById[id]] === 'approved',
  ).length;
  const selectedUnapprovedCount = Array.from(selectedIds).filter(
    (id) => keyById[id] && reviews[keyById[id]] !== 'approved',
  ).length;
  return (
    <Stack space="xs">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          New articles ({rows.length})
        </Text>
        <Button
          variant="secondary"
          onClick={onApproveSelected}
          disabled={selectedUnapprovedCount === 0}
        >
          {`Approve selected (${selectedUnapprovedCount})`}
        </Button>
        <Button
          variant="tertiary"
          onClick={onUnapproveSelected}
          disabled={selectedApprovedCount === 0}
        >
          {`Remove approval (${selectedApprovedCount})`}
        </Button>
      </Inline>
      {rows.length === 0 ? (
        <Text color="secondary" size="s">
          No new-article candidates in this category.
        </Text>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>
                <input
                  type="checkbox"
                  checked={allReviewableChecked}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  aria-label="Select all reviewable articles in this category"
                  disabled={reviewableIds.length === 0}
                />
              </th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Codes</th>
              <th style={thStyle}># Codes</th>
              <th style={thStyle}>Importance</th>
              <th style={thStyle}>Coverage</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              if (!r.id) return null;
              const rowId = r.id;
              const status = reviews[r.articleKey ?? ''];
              const isReviewable = Boolean(r.articleKey);
              const tint = rowTint(status);
              const rowStyle: CSSProperties = {
                ...(tint ?? (i % 2 === 1 ? { background: ZEBRA_TINT } : undefined)),
                cursor: 'pointer',
              };
              return (
                <tr key={rowId} style={rowStyle} onClick={() => onRowClick(rowId)}>
                  <td style={checkboxTdStyle}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(rowId)}
                      onChange={() => onToggle(rowId)}
                      aria-label={`Select article ${r.articleTitle ?? rowId}`}
                      disabled={!isReviewable}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={tdStyle}>
                    <Text size="s">{r.articleTitle ?? '—'}</Text>
                  </td>
                  <td style={tdStyle}>
                    {r.codes.length >= GROUPED_CODES_THRESHOLD ? (
                      <CategoryGroupedCodeList
                        codes={r.codes}
                        categoryLookup={categoryLookup}
                      />
                    ) : (
                      <CodeChipList codes={r.codes} categoryLookup={categoryLookup} />
                    )}
                  </td>
                  <td style={numTdStyle}>{r.numCodes}</td>
                  <td style={numTdStyle}>{r.overallImportance ?? '—'}</td>
                  <td style={numTdStyle}>
                    {r.overallCoverage ?? r.existingAmbossCoverage ?? '—'}
                  </td>
                  <td style={decisionCellStyle}>
                    <DecisionButtons
                      status={status}
                      disabled={!isReviewable}
                      approveTitle="Approve this article"
                      rejectTitle="Reject this article"
                      onDecide={(nextStatus) => onDecideRow(rowId, nextStatus)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Stack>
  );
}

function SectionSubTable({
  rows,
  reviews,
  selectedIds,
  onToggle,
  onToggleAll,
  onRowClick,
  onApproveSelected,
  onUnapproveSelected,
  onDecideRow,
  categoryLookup,
}: {
  rows: SectionRow[];
  reviews: ReviewMap;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onRowClick: (id: string) => void;
  onApproveSelected: () => void;
  onUnapproveSelected: () => void;
  onDecideRow: (id: string, status: ReviewStatus | null) => void;
  categoryLookup: CategoryLookup;
}) {
  const keyById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of rows) if (r.id && r.sectionKey) out[r.id] = r.sectionKey;
    return out;
  }, [rows]);
  const reviewableIds = rows.flatMap((r) => (r.id && r.sectionKey ? [r.id] : []));
  const allReviewableChecked =
    reviewableIds.length > 0 && reviewableIds.every((id) => selectedIds.has(id));
  const selectedApprovedCount = Array.from(selectedIds).filter(
    (id) => keyById[id] && reviews[keyById[id]] === 'approved',
  ).length;
  const selectedUnapprovedCount = Array.from(selectedIds).filter(
    (id) => keyById[id] && reviews[keyById[id]] !== 'approved',
  ).length;
  // Band by parent-article title so all sections under one article
  // share a tint; the band flips on every article transition. Rows
  // are scoped per-category here, so sections sharing a title sit
  // together naturally.
  const bandByRowId = new Map<string, 0 | 1>();
  {
    let band: 0 | 1 = 0;
    let lastTitle: string | null = null;
    for (const r of rows) {
      if (!r.id) continue;
      const title = r.articleTitle ?? '';
      if (lastTitle !== null && title !== lastTitle) {
        band = band === 0 ? 1 : 0;
      }
      bandByRowId.set(r.id, band);
      lastTitle = title;
    }
  }
  return (
    <Stack space="xs">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          Sections ({rows.length})
        </Text>
        <Button
          variant="secondary"
          onClick={onApproveSelected}
          disabled={selectedUnapprovedCount === 0}
        >
          {`Approve selected (${selectedUnapprovedCount})`}
        </Button>
        <Button
          variant="tertiary"
          onClick={onUnapproveSelected}
          disabled={selectedApprovedCount === 0}
        >
          {`Remove approval (${selectedApprovedCount})`}
        </Button>
      </Inline>
      {rows.length === 0 ? (
        <Text color="secondary" size="s">
          No section-update candidates in this category.
        </Text>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>
                <input
                  type="checkbox"
                  checked={allReviewableChecked}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  aria-label="Select all reviewable section updates in this category"
                  disabled={reviewableIds.length === 0}
                />
              </th>
              <th style={thStyle}>Parent article</th>
              <th style={thStyle}>Section</th>
              <th style={thStyle}>Update type</th>
              <th style={thStyle}>Codes</th>
              <th style={thStyle}># Codes</th>
              <th style={thStyle}>Importance</th>
              <th style={thStyle}>Coverage</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (!r.id) return null;
              const rowId = r.id;
              const status = reviews[r.sectionKey ?? ''];
              const isReviewable = Boolean(r.sectionKey);
              const tint = rowTint(status);
              const band = bandByRowId.get(rowId);
              const rowStyle: CSSProperties = {
                ...(tint ?? (band === 1 ? { background: ZEBRA_TINT } : undefined)),
                cursor: 'pointer',
              };
              const updateLabel =
                r.updateType === 'new'
                  ? 'new'
                  : r.updateType === 'update'
                    ? 'update'
                    : '—';
              const updateColor =
                r.updateType === 'new'
                  ? 'blue'
                  : r.updateType === 'update'
                    ? 'purple'
                    : 'gray';
              return (
                <tr key={rowId} style={rowStyle} onClick={() => onRowClick(rowId)}>
                  <td style={checkboxTdStyle}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(rowId)}
                      onChange={() => onToggle(rowId)}
                      aria-label={`Select section ${r.sectionName ?? rowId}`}
                      disabled={!isReviewable}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={tdStyle}>
                    <Text size="s">{r.articleTitle ?? '—'}</Text>
                  </td>
                  <td style={tdStyle}>
                    <Text size="s">{r.sectionName ?? '—'}</Text>
                  </td>
                  <td style={tdStyle}>
                    <Badge text={updateLabel} color={updateColor} />
                  </td>
                  <td style={tdStyle}>
                    {r.codes.length >= GROUPED_CODES_THRESHOLD ? (
                      <CategoryGroupedCodeList
                        codes={r.codes}
                        categoryLookup={categoryLookup}
                      />
                    ) : (
                      <CodeChipList codes={r.codes} categoryLookup={categoryLookup} />
                    )}
                  </td>
                  <td style={numTdStyle}>{r.numCodes}</td>
                  <td style={numTdStyle}>{r.overallImportance ?? '—'}</td>
                  <td style={numTdStyle}>{r.overallCoverage ?? '—'}</td>
                  <td style={decisionCellStyle}>
                    <DecisionButtons
                      status={status}
                      disabled={!isReviewable}
                      approveTitle="Approve this section"
                      rejectTitle="Reject this section"
                      onDecide={(nextStatus) => onDecideRow(rowId, nextStatus)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Stack>
  );
}
