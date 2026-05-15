'use client';

import { Badge, Button, Inline, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import type { ReviewCommentRecord } from '@/lib/pb/types';
import {
  bulkApproveArticleReviews,
  bulkApproveSectionReviews,
  setConsolidationCategoryReview,
} from '../[specialty]/actions';
import {
  ArticleManagerModalV2,
  type ReviewerMap,
  type ReviewMap,
} from './article-manager-modal-v2';
import type { ArticleRow } from './articles-view';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, TitleOriginLookup } from './code-utils';
import type { SectionRow } from './sections-view';

type CategoryBucket = {
  articles: ArticleRow[];
  sections: SectionRow[];
};

const UNCATEGORIZED = '(uncategorized)';

// Tints reused from the New Articles / Article Updates tables so a row's
// approval state reads identically across screens.
const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';

type ModalOpener =
  | { kind: 'article'; startAtId: string }
  | { kind: 'section'; startAtId: string }
  | null;

export function ConsolidationReviewView({
  slug,
  initialCategory,
  articles,
  sections,
  flaggedCategories,
  mappingByCategory,
  categoryLookup,
  titleOriginLookup,
  initialArticleReviews,
  initialArticleReviewers,
  initialSectionReviews,
  initialSectionReviewers,
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
  flaggedCategories: string[];
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
  initialSectionReviews: ReviewMap;
  initialSectionReviewers: ReviewerMap;
  initialNotesByArticle: Record<string, string>;
  initialNotesBySection: Record<string, string>;
  initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
  initialCommentsBySection: Record<string, ReviewCommentRecord[]>;
  initialCommentsByParentArticle: Record<string, ReviewCommentRecord[]>;
  viewerEmail?: string;
}) {
  const [articleReviews, setArticleReviews] = useState<ReviewMap>(initialArticleReviews);
  const [articleReviewers, setArticleReviewers] = useState<ReviewerMap>(
    initialArticleReviewers,
  );
  const [sectionReviews, setSectionReviews] = useState<ReviewMap>(initialSectionReviews);
  const [sectionReviewers, setSectionReviewers] = useState<ReviewerMap>(
    initialSectionReviewers,
  );
  const [flaggedSet, setFlaggedSet] = useState<Set<string>>(
    () => new Set(flaggedCategories),
  );
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalOpener>(null);
  const [_pending, startTransition] = useTransition();
  // Categories whose consolidation request is in flight. Drives the rail
  // button's "Starting…" label so consecutive clicks don't fan out runs.
  const [consolidatingSet, setConsolidatingSet] = useState<Set<string>>(new Set());
  const [consolidateError, setConsolidateError] = useState<string | null>(null);
  const router = useRouter();

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

  // Rail categories = union of (categories that already have consolidated
  // output) ∪ (categories that have mapped codes but haven't been
  // consolidated yet). The second set is essential — without it, a
  // freshly-mapped category never appears in the rail and the user has
  // no way to trigger primary consolidation for it.
  const categories = useMemo(() => {
    const set = new Set<string>(grouped.keys());
    for (const cat of Object.keys(mappingByCategory)) set.add(cat);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [grouped, mappingByCategory]);

  const [selectedCategoryRaw, setSelectedCategoryRaw] = useState<string | null>(
    initialCategory,
  );
  // Resolve to the first category if the URL value doesn't exist (yet) in
  // `grouped` — e.g. on hard reload of a stale URL after a re-run.
  const selectedCategory = useMemo(() => {
    if (selectedCategoryRaw && grouped.has(selectedCategoryRaw)) {
      return selectedCategoryRaw;
    }
    return categories[0] ?? null;
  }, [selectedCategoryRaw, grouped, categories]);

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
        if (a.id && articleReviews[a.id] === 'approved') articleApproved++;
      }
      for (const s of bucket.sections) {
        if (s.id && sectionReviews[s.id] === 'approved') sectionApproved++;
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
  // Optimistic state is keyed by articleKey/sectionKey (the stable id);
  // the server action takes the pair (key, current PB id) so the
  // legacy `articleRecordId` column on the PB row keeps tracking the
  // freshest underlying row.

  const approveArticles = useCallback(
    (pairs: Array<{ articleKey: string; articleRecordId: string }>) => {
      if (pairs.length === 0) return;
      const now = Date.now();
      // Optimistic mirror — the local maps are keyed by the row's PB
      // id (`articleRecordId`), so the inline table can do an O(1)
      // status lookup without crossing into the key space. The server
      // action persists with the stable key alongside the id.
      setArticleReviews((prev) => {
        const next = { ...prev };
        for (const p of pairs) next[p.articleRecordId] = 'approved';
        return next;
      });
      setArticleReviewers((prev) => {
        const next = { ...prev };
        for (const p of pairs)
          next[p.articleRecordId] = { reviewerEmail: viewerEmail, reviewedAt: now };
        return next;
      });
      startTransition(async () => {
        await bulkApproveArticleReviews(slug, pairs);
      });
    },
    [slug, viewerEmail],
  );

  const approveSections = useCallback(
    (pairs: Array<{ sectionKey: string; sectionRecordId: string }>) => {
      if (pairs.length === 0) return;
      const now = Date.now();
      setSectionReviews((prev) => {
        const next = { ...prev };
        for (const p of pairs) next[p.sectionRecordId] = 'approved';
        return next;
      });
      setSectionReviewers((prev) => {
        const next = { ...prev };
        for (const p of pairs)
          next[p.sectionRecordId] = { reviewerEmail: viewerEmail, reviewedAt: now };
        return next;
      });
      startTransition(async () => {
        await bulkApproveSectionReviews(slug, pairs);
      });
    },
    [slug, viewerEmail],
  );

  const approveAllInCategory = useCallback(() => {
    if (!selectedBucket) return;
    const articlePairs = selectedBucket.articles
      .filter((a) => a.articleKey && a.id && articleReviews[a.id] !== 'approved')
      .map((a) => ({
        articleKey: a.articleKey as string,
        articleRecordId: a.id as string,
      }));
    const sectionPairs = selectedBucket.sections
      .filter((s) => s.sectionKey && s.id && sectionReviews[s.id] !== 'approved')
      .map((s) => ({
        sectionKey: s.sectionKey as string,
        sectionRecordId: s.id as string,
      }));
    approveArticles(articlePairs);
    approveSections(sectionPairs);
    setSelectedArticleIds(new Set());
    setSelectedSectionIds(new Set());
  }, [selectedBucket, articleReviews, sectionReviews, approveArticles, approveSections]);

  // ----- Re-run flag -----
  const toggleFlag = useCallback(
    (cat: string, flagged: boolean) => {
      setFlaggedSet((prev) => {
        const next = new Set(prev);
        if (flagged) next.add(cat);
        else next.delete(cat);
        return next;
      });
      startTransition(async () => {
        await setConsolidationCategoryReview(
          slug,
          cat,
          flagged ? 'flagged-for-rerun' : null,
        );
      });
    },
    [slug],
  );

  // ----- Per-category consolidation trigger -----
  const startConsolidation = useCallback(
    async (category: string) => {
      if (consolidatingSet.has(category)) return;
      setConsolidateError(null);
      setConsolidatingSet((prev) => {
        const next = new Set(prev);
        next.add(category);
        return next;
      });
      try {
        const res = await fetch('/api/workflows/consolidate-primary', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            specialtySlug: slug,
            categories: [category],
            chainSecondaries: true,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setConsolidateError(
            body?.error ?? `HTTP ${res.status} starting consolidation for ${category}`,
          );
          return;
        }
        router.refresh();
      } catch (e) {
        setConsolidateError(e instanceof Error ? e.message : String(e));
      } finally {
        setConsolidatingSet((prev) => {
          const next = new Set(prev);
          next.delete(category);
          return next;
        });
      }
    },
    [slug, router, consolidatingSet],
  );

  // ----- Modal close -----
  const closeModal = useCallback(() => setModal(null), []);

  return (
    <Stack space="m">
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
          flaggedSet={flaggedSet}
          mappingByCategory={mappingByCategory}
          selectedCategory={selectedCategory}
          onSelect={selectCategory}
          consolidatingSet={consolidatingSet}
          onStartConsolidation={startConsolidation}
          consolidateError={consolidateError}
          onDismissError={() => setConsolidateError(null)}
        />
        <div style={{ minWidth: 0 }}>
          {selectedCategory && selectedBucket ? (
            <CategoryDetailPane
              category={selectedCategory}
              bucket={selectedBucket}
              flagged={flaggedSet.has(selectedCategory)}
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
                  .filter((a) => a.id && a.articleKey && selectedArticleIds.has(a.id))
                  .map((a) => ({
                    articleKey: a.articleKey as string,
                    articleRecordId: a.id as string,
                  }));
                approveArticles(pairs);
                setSelectedArticleIds(new Set());
              }}
              onApproveSelectedSections={() => {
                if (!selectedBucket) return;
                const pairs = selectedBucket.sections
                  .filter((s) => s.id && s.sectionKey && selectedSectionIds.has(s.id))
                  .map((s) => ({
                    sectionKey: s.sectionKey as string,
                    sectionRecordId: s.id as string,
                  }));
                approveSections(pairs);
                setSelectedSectionIds(new Set());
              }}
              onApproveAll={approveAllInCategory}
              onToggleFlag={(flagged) => toggleFlag(selectedCategory, flagged)}
              onRowClickArticle={(id) => setModal({ kind: 'article', startAtId: id })}
              onRowClickSection={(id) => setModal({ kind: 'section', startAtId: id })}
            />
          ) : (
            <Text color="secondary">
              {articles.length + sections.length === 0
                ? `No 1st-pass content for this specialty yet (consolidatedArticles: ${articles.length}, consolidatedSections: ${sections.length}). Run the consolidation pipeline first, or re-seed your data.`
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
            onReviewsChange: setArticleReviews,
            onReviewersChange: setArticleReviewers,
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
            onReviewsChange: setSectionReviews,
            onReviewersChange: setSectionReviewers,
          }}
          onClose={closeModal}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Left rail — list of categories with progress badges
// ---------------------------------------------------------------------------

function CategoryRail({
  categories,
  counts,
  flaggedSet,
  mappingByCategory,
  selectedCategory,
  onSelect,
  consolidatingSet,
  onStartConsolidation,
  consolidateError,
  onDismissError,
}: {
  categories: string[];
  counts: Record<
    string,
    { articleApproved: number; sectionApproved: number; total: number }
  >;
  flaggedSet: Set<string>;
  mappingByCategory: Record<string, { mapped: number; total: number; ready: boolean }>;
  selectedCategory: string | null;
  onSelect: (cat: string) => void;
  consolidatingSet: Set<string>;
  onStartConsolidation: (cat: string) => void;
  consolidateError: string | null;
  onDismissError: () => void;
}) {
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        borderRight: '1px solid rgb(228, 228, 234)',
        paddingRight: 12,
      }}
    >
      <Stack space="xs">
        {consolidateError ? (
          <button
            type="button"
            onClick={onDismissError}
            style={{
              textAlign: 'left',
              padding: '6px 8px',
              border: '1px solid rgb(220, 38, 38)',
              borderRadius: 4,
              background: 'rgb(254, 226, 226)',
              cursor: 'pointer',
              font: 'inherit',
              color: 'rgb(127, 29, 29)',
              fontSize: 12,
            }}
            title="Dismiss"
          >
            {consolidateError}
          </button>
        ) : null}
        {categories.length === 0 && (
          <Text color="secondary" size="s">
            No categories yet.
          </Text>
        )}
        {categories.map((cat) => {
          const c = counts[cat] ?? { articleApproved: 0, sectionApproved: 0, total: 0 };
          const approved = c.articleApproved + c.sectionApproved;
          const isActive = cat === selectedCategory;
          const isFlagged = flaggedSet.has(cat);
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
          const isConsolidating = consolidatingSet.has(cat);
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
                <Inline space="xxs" vAlignItems="center">
                  {isFlagged && <Badge text="re-run" color="red" />}
                  {allApproved && !isFlagged && (
                    <Badge text="all approved" color="green" />
                  )}
                  {!allApproved && !isFlagged && hasOutput && (
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
              </button>
              {mapping?.ready ? (
                <Button
                  variant={hasOutput ? 'tertiary' : 'secondary'}
                  fullWidth
                  onClick={() => onStartConsolidation(cat)}
                  disabled={isConsolidating}
                >
                  {isConsolidating
                    ? 'Consolidating…'
                    : hasOutput
                      ? 'Re-run consolidation'
                      : 'Start consolidation'}
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
  flagged,
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
  onApproveAll,
  onToggleFlag,
  onRowClickArticle,
  onRowClickSection,
}: {
  category: string;
  bucket: CategoryBucket;
  flagged: boolean;
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
  onApproveAll: () => void;
  onToggleFlag: (flagged: boolean) => void;
  onRowClickArticle: (id: string) => void;
  onRowClickSection: (id: string) => void;
}) {
  const unapprovedCount =
    bucket.articles.filter((a) => a.id && articleReviews[a.id] !== 'approved').length +
    bucket.sections.filter((s) => s.id && sectionReviews[s.id] !== 'approved').length;

  return (
    <Stack space="m">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          {category}
        </Text>
        {flagged && <Badge text="flagged for re-run" color="red" />}
      </Inline>

      <Inline space="xs" vAlignItems="center">
        <Button variant="primary" onClick={onApproveAll} disabled={unapprovedCount === 0}>
          {`Approve all unapproved (${unapprovedCount})`}
        </Button>
        {flagged ? (
          <Button variant="tertiary" onClick={() => onToggleFlag(false)}>
            Clear re-run flag
          </Button>
        ) : (
          <Button variant="tertiary" onClick={() => onToggleFlag(true)}>
            Flag category for re-run
          </Button>
        )}
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
            if (a.id && articleReviews[a.id] !== 'approved') next.add(a.id);
          }
          setSelectedArticleIds(next);
        }}
        onRowClick={onRowClickArticle}
        onApproveSelected={onApproveSelectedArticles}
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
            if (s.id && sectionReviews[s.id] !== 'approved') next.add(s.id);
          }
          setSelectedSectionIds(next);
        }}
        onRowClick={onRowClickSection}
        onApproveSelected={onApproveSelectedSections}
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

function rowTint(status: 'approved' | 'rejected' | undefined): CSSProperties | undefined {
  if (status === 'approved') return { background: APPROVED_TINT };
  if (status === 'rejected') return { background: REJECTED_TINT };
  return undefined;
}

function StatusBadge({ status }: { status: 'approved' | 'rejected' | undefined }) {
  if (status === 'approved') return <Badge text="approved" color="green" />;
  if (status === 'rejected') return <Badge text="rejected" color="red" />;
  return (
    <Text color="secondary" size="xs">
      —
    </Text>
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
  categoryLookup,
}: {
  rows: ArticleRow[];
  reviews: ReviewMap;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onRowClick: (id: string) => void;
  onApproveSelected: () => void;
  categoryLookup: CategoryLookup;
}) {
  const unapprovedRows = rows.filter((r) => r.id && reviews[r.id] !== 'approved');
  const allUnapprovedChecked =
    unapprovedRows.length > 0 &&
    unapprovedRows.every((r) => r.id && selectedIds.has(r.id));
  return (
    <Stack space="xs">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          New articles ({rows.length})
        </Text>
        <Button
          variant="secondary"
          onClick={onApproveSelected}
          disabled={selectedIds.size === 0}
        >
          {`Approve selected (${selectedIds.size})`}
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
                  checked={allUnapprovedChecked}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  aria-label="Select all unapproved articles in this category"
                  disabled={unapprovedRows.length === 0}
                />
              </th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Codes</th>
              <th style={thStyle}># Codes</th>
              <th style={thStyle}>Importance</th>
              <th style={thStyle}>Coverage</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (!r.id) return null;
              const rowId = r.id;
              const status = reviews[rowId];
              const rowStyle: CSSProperties = {
                ...rowTint(status),
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
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={tdStyle}>
                    <Text size="s">{r.articleTitle ?? '—'}</Text>
                  </td>
                  <td style={tdStyle}>
                    <CodeChipList codes={r.codes} categoryLookup={categoryLookup} />
                  </td>
                  <td style={numTdStyle}>{r.numCodes}</td>
                  <td style={numTdStyle}>{r.overallImportance ?? '—'}</td>
                  <td style={numTdStyle}>
                    {r.overallCoverage ?? r.existingAmbossCoverage ?? '—'}
                  </td>
                  <td style={tdStyle}>
                    <StatusBadge status={status} />
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
  categoryLookup,
}: {
  rows: SectionRow[];
  reviews: ReviewMap;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onRowClick: (id: string) => void;
  onApproveSelected: () => void;
  categoryLookup: CategoryLookup;
}) {
  const unapprovedRows = rows.filter((r) => r.id && reviews[r.id] !== 'approved');
  const allUnapprovedChecked =
    unapprovedRows.length > 0 &&
    unapprovedRows.every((r) => r.id && selectedIds.has(r.id));
  return (
    <Stack space="xs">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          Section updates ({rows.length})
        </Text>
        <Button
          variant="secondary"
          onClick={onApproveSelected}
          disabled={selectedIds.size === 0}
        >
          {`Approve selected (${selectedIds.size})`}
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
                  checked={allUnapprovedChecked}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  aria-label="Select all unapproved section updates in this category"
                  disabled={unapprovedRows.length === 0}
                />
              </th>
              <th style={thStyle}>Section</th>
              <th style={thStyle}>Parent article</th>
              <th style={thStyle}>Update type</th>
              <th style={thStyle}>Codes</th>
              <th style={thStyle}># Codes</th>
              <th style={thStyle}>Importance</th>
              <th style={thStyle}>Coverage</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (!r.id) return null;
              const rowId = r.id;
              const status = reviews[rowId];
              const rowStyle: CSSProperties = {
                ...rowTint(status),
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
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td style={tdStyle}>
                    <Text size="s">{r.sectionName ?? '—'}</Text>
                  </td>
                  <td style={tdStyle}>
                    <Text size="s">{r.articleTitle ?? '—'}</Text>
                  </td>
                  <td style={tdStyle}>
                    <Badge text={updateLabel} color={updateColor} />
                  </td>
                  <td style={tdStyle}>
                    <CodeChipList codes={r.codes} categoryLookup={categoryLookup} />
                  </td>
                  <td style={numTdStyle}>{r.numCodes}</td>
                  <td style={numTdStyle}>{r.overallImportance ?? '—'}</td>
                  <td style={numTdStyle}>{r.overallCoverage ?? '—'}</td>
                  <td style={tdStyle}>
                    <StatusBadge status={status} />
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
