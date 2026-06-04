'use client';

import {
  Badge,
  Button,
  Inline,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ArticleBacklogRecord,
  ArticleBacklogStatus,
  ArticleLitSearchRunRecord,
  ArticleSourceRecord,
  ReviewCommentRecord,
  SourceReviewStatus,
} from '@/lib/pb/types';
import { isSafeUrl } from '@/lib/url';
import {
  getLatestDraftForArticle,
  resetArticle,
  submitSourceCortexId,
  submitSourceDoi,
  submitSourceNotes,
  submitSourceReview,
  submitSourcesOrder,
  submitSourceUrl,
} from '../[specialty]/actions';
import { AddSourceModal } from './add-source-modal';
import type { ArticleRow } from './articles-view';
import {
  type ArticleManagerPhase,
  PHASE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from './backlog-constants';
import type { BacklogRow } from './backlog-view';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, TitleOriginLookup } from './code-utils';
import { CommentsSection } from './comments-section';
import { DraftArticleButton } from './draft-article-button';
import { LitSearchPhase1Panel } from './lit-search-phase1-panel';
import { LitSearchProgressBadge } from './lit-search-progress-badge';
import {
  canApproveSources,
  canDraft,
  canRunLitSearch,
  canStartDraft,
  missingCortexIdCount,
  phaseFromStatus,
} from './pipeline-stage-gates';
import type { SectionRow } from './sections-view';
import { deriveLitSearchSnapshot } from './use-running-lit-search-articles';

// ---------------------------------------------------------------------------
// Shared types — used by both review-stage variants. Kept here so the v2
// modal is self-contained while the legacy review-modal.tsx is removed in
// the Phase 2 cleanup.
// ---------------------------------------------------------------------------

export type ReviewStatus = 'approved' | 'rejected';
export type ReviewMap = Record<string, ReviewStatus>;

export type ReviewerInfo = { reviewerEmail?: string; reviewedAt?: number };
export type ReviewerMap = Record<string, ReviewerInfo>;

function reviewerHandle(email?: string): string {
  if (!email) return 'unknown';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export function reviewerLabel(
  info: ReviewerInfo | undefined,
  status: ReviewStatus,
): string {
  const handle = reviewerHandle(info?.reviewerEmail);
  const when = info?.reviewedAt ? new Date(info.reviewedAt).toLocaleString() : null;
  return when ? `${status} by ${handle} · ${when}` : `${status} by ${handle}`;
}

// ---------------------------------------------------------------------------
// Opener — one discriminated union covering all three lifecycle stages.
// ---------------------------------------------------------------------------

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

export function ArticleManagerModalV2({
  opener,
  onClose,
}: {
  opener: ManagerOpener;
  onClose: () => void;
}) {
  if (opener.stage === 'backlog') {
    if (opener.type === 'update') {
      return <BacklogUpdateView opener={opener} onClose={onClose} />;
    }
    return <BacklogManagerView opener={opener} onClose={onClose} />;
  }
  if (opener.type === 'update') {
    return <UpdateReviewView opener={opener} onClose={onClose} />;
  }
  return <ReviewManagerView opener={opener} onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// Shared sort for review stages — alphabetical by category, importance desc
// within bucket. Same logic as the old ReviewModal.
// ---------------------------------------------------------------------------

type SortedReviewRow = ArticleRow & { id: string; category: string };

function sortForReview(rows: ArticleRow[]): SortedReviewRow[] {
  const out: SortedReviewRow[] = [];
  for (const r of rows) {
    if (!r.id) continue;
    out.push({ ...r, id: r.id, category: r.category ?? '(uncategorized)' });
  }
  out.sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c !== 0) return c;
    return (b.overallImportance ?? -Infinity) - (a.overallImportance ?? -Infinity);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Review stage — replaces the old ReviewModal. Adds a per-article notes
// textarea above the decision buttons that pipes into submitArticleReview's
// notes param. Comments rail unchanged.
// ---------------------------------------------------------------------------

type ReviewOpener = Extract<
  ManagerOpener,
  { type: 'new'; stage: 'review-1st' | 'review-2nd' }
>;

function ReviewManagerView({
  opener,
  onClose,
}: {
  opener: ReviewOpener;
  onClose: () => void;
}) {
  const {
    slug,
    articles,
    passLabel,
    startAtId,
    initialReviews,
    initialReviewers,
    initialCommentsByArticle,
    initialNotesByArticle,
    categoryLookup,
    titleOriginLookup,
    viewerEmail,
    onDecideArticle,
  } = opener;

  const sorted = useMemo(() => sortForReview(articles), [articles]);
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewers, setReviewers] = useState<ReviewerMap>(initialReviewers);
  const [notesByKey, setNotesByKey] =
    useState<Record<string, string>>(initialNotesByArticle);
  useEffect(() => {
    setReviews(initialReviews);
    setReviewers(initialReviewers);
    setNotesByKey(initialNotesByArticle);
  }, [initialReviews, initialReviewers, initialNotesByArticle]);
  const [index, setIndex] = useState(() => {
    if (startAtId) {
      const at = sorted.findIndex((r) => r.id === startAtId);
      if (at !== -1) return at;
    }
    const firstUnreviewed = sorted.findIndex((r) => !initialReviews[r.articleKey ?? '']);
    return firstUnreviewed === -1 ? 0 : firstUnreviewed;
  });
  const [submitting, setSubmitting] = useState(false);

  const total = sorted.length;
  const current = sorted[index];

  const bucketStats = useMemo(() => {
    if (!current) return null;
    const inBucket = sorted.filter((r) => r.category === current.category);
    const seen = inBucket.findIndex((r) => r.id === current.id);
    const approved = inBucket.filter(
      (r) => reviews[r.articleKey ?? ''] === 'approved',
    ).length;
    const rejected = inBucket.filter(
      (r) => reviews[r.articleKey ?? ''] === 'rejected',
    ).length;
    return {
      bucketSize: inBucket.length,
      indexInBucket: seen + 1,
      approved,
      rejected,
      unreviewed: inBucket.length - approved - rejected,
    };
  }, [current, sorted, reviews]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers close over latest state via listed deps; adding decide/goNext/goPrev/onClose rebinds every render.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          if (e.key === 'Escape') onClose();
          return;
        }
      }
      if (submitting) return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'a' || e.key === 'A' || e.key === 'y' || e.key === 'Y') {
        decide('approved');
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'n' || e.key === 'N') {
        decide('rejected');
      } else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, total, current?.id, submitting]);

  function goNext() {
    setIndex((i) => Math.min(total - 1, i + 1));
  }
  function goPrev() {
    setIndex((i) => Math.max(0, i - 1));
  }

  async function decide(status: ReviewStatus) {
    if (!current) return;
    const rowId = current.id;
    const articleKey = current.articleKey ?? '';
    if (!articleKey) {
      console.error('decide: row has no articleKey — cannot persist review');
      return;
    }
    const notesValue = notesByKey[articleKey] ?? '';
    setSubmitting(true);
    // Modal-local UI state: flips immediately so the row's badge in the
    // modal turns green/red without waiting for the network. The parent
    // is updated via `onDecideArticle` which routes through the shared
    // `useApprovalState` hook (optimistic patch + server action).
    const next: ReviewMap = { ...reviews, [articleKey]: status };
    const nextReviewers: ReviewerMap = {
      ...reviewers,
      [articleKey]: { reviewerEmail: viewerEmail, reviewedAt: Date.now() },
    };
    setReviews(next);
    setReviewers(nextReviewers);
    try {
      await onDecideArticle(articleKey, rowId, status, notesValue);
    } catch (err) {
      console.error('decideArticle failed', err);
      // Roll back the modal-local snapshot — the hook has already
      // rolled back its patches.
      const revertedReviews = { ...reviews };
      const revertedReviewers = { ...reviewers };
      delete revertedReviews[articleKey];
      delete revertedReviewers[articleKey];
      setReviews(revertedReviews);
      setReviewers(revertedReviewers);
    } finally {
      setSubmitting(false);
      if (index < total - 1) goNext();
    }
  }

  async function clearDecision() {
    if (!current) return;
    const articleKey = current.articleKey ?? '';
    if (!articleKey) return;
    const rowId = current.id;
    setSubmitting(true);
    const next = { ...reviews };
    const nextReviewers = { ...reviewers };
    delete next[articleKey];
    delete nextReviewers[articleKey];
    setReviews(next);
    setReviewers(nextReviewers);
    try {
      await onDecideArticle(articleKey, rowId, null);
    } catch (err) {
      console.error('decideArticle (reset) failed', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!current) {
    return (
      <Modal
        header="Review consolidations"
        size="m"
        onAction={() => onClose()}
        actionButton={{ text: 'Close', onClick: onClose }}
      >
        <Modal.Text>No articles to review.</Modal.Text>
      </Modal>
    );
  }

  const currentKey = current.articleKey ?? '';
  const currentStatus = reviews[currentKey];
  const previousTitles = (
    current as ArticleRow & { previousArticleTitleSuggestions?: string[] }
  ).previousArticleTitleSuggestions;
  const currentNotes = notesByKey[currentKey] ?? '';

  return (
    <Modal
      header={
        passLabel
          ? `Manage article · ${passLabel} · ${index + 1} of ${total}`
          : `Manage article · ${index + 1} of ${total}`
      }
      subHeader={`${current.category} — ${bucketStats?.indexInBucket}/${bucketStats?.bucketSize} in bucket · ${bucketStats?.approved} approved · ${bucketStats?.rejected} rejected · ${bucketStats?.unreviewed} unreviewed`}
      size="l"
      isDismissible
      onAction={() => onClose()}
      privateProps={{ height: '90vh' }}
      closeButtonAriaLabel="Close manager"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <SharedHeader
            title={current.articleTitle ?? '(untitled)'}
            stageBadge={{ text: 'Review', color: 'gray' }}
            decisionBadge={
              currentStatus === 'approved'
                ? {
                    text: 'approved',
                    color: 'green',
                    tooltip: reviewerLabel(reviewers[currentKey], 'approved'),
                  }
                : currentStatus === 'rejected'
                  ? {
                      text: 'rejected',
                      color: 'red',
                      tooltip: reviewerLabel(reviewers[currentKey], 'rejected'),
                    }
                  : null
            }
            metaInline={
              <Inline space="s">
                {current.articleType && (
                  <Text size="xs" color="secondary">
                    Type: {current.articleType}
                  </Text>
                )}
                {typeof current.overallImportance === 'number' && (
                  <Text size="xs" color="secondary">
                    Importance: {current.overallImportance}
                  </Text>
                )}
                {typeof current.overallCoverage === 'number' && (
                  <Text size="xs" color="secondary">
                    Coverage: {current.overallCoverage}
                  </Text>
                )}
                <Text size="xs" color="secondary">
                  # Codes: {current.numCodes}
                </Text>
              </Inline>
            }
          />

          <Stack space="xs">
            <Text size="s" weight="bold">
              Codes ({current.codes.length})
            </Text>
            <CodeChipList codes={current.codes} categoryLookup={categoryLookup} />
          </Stack>

          {previousTitles && previousTitles.length > 0 && (
            <Stack space="xs">
              <Text size="s" weight="bold">
                Previous article titles
              </Text>
              {Array.from(new Set(previousTitles)).map((t) => {
                const origin = titleOriginLookup[t];
                const tagText =
                  origin?.kind === 'article'
                    ? 'article'
                    : origin?.kind === 'section'
                      ? `section in "${origin.inArticle}"`
                      : origin?.kind === 'both'
                        ? `article + section in "${origin.inArticle}"`
                        : null;
                return (
                  <Inline key={t} space="xs" vAlignItems="center">
                    <Text size="xs">· {t}</Text>
                    {tagText && (
                      <Badge
                        text={tagText}
                        color={origin?.kind === 'section' ? 'purple' : 'blue'}
                      />
                    )}
                  </Inline>
                );
              })}
            </Stack>
          )}

          {current.justification && (
            <Stack space="xs">
              <Text size="s" weight="bold">
                Justification
              </Text>
              <Text size="s" color="secondary">
                {current.justification}
              </Text>
            </Stack>
          )}

          <DecisionNoteField
            value={currentNotes}
            onChange={(v) => setNotesByKey((prev) => ({ ...prev, [currentKey]: v }))}
            placeholder="Decision rationale (optional — saved when you approve or reject)"
          />

          <CommentsSection
            key={current.id}
            slug={slug}
            recordKind="article"
            recordKey={current.articleKey ?? ''}
            recordId={current.id}
            initialComments={initialCommentsByArticle[current.articleKey ?? ''] ?? []}
            viewerEmail={viewerEmail}
          />
        </div>

        <div style={footerStyle}>
          <Button
            variant="tertiary"
            onClick={goPrev}
            disabled={index === 0 || submitting}
          >
            ← Prev
          </Button>
          <Button
            variant="tertiary"
            onClick={goNext}
            disabled={index === total - 1 || submitting}
          >
            Skip / Next →
          </Button>
          <span style={{ flex: 1 }} />
          {currentStatus && (
            <Button variant="tertiary" onClick={clearDecision} disabled={submitting}>
              Clear decision
            </Button>
          )}
          <Button
            variant="secondary"
            destructive
            onClick={() => decide('rejected')}
            disabled={submitting}
          >
            Reject (R)
          </Button>
          <Button
            variant="primary"
            onClick={() => decide('approved')}
            disabled={submitting}
          >
            Approve (A)
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Backlog stage — replaces the old ArticleManagerModal. Adds comments rail
// (keyed on newArticleSuggestions.id, same as 2nd-pass) plus a notes
// textarea that piggybacks on the next status pick.
// ---------------------------------------------------------------------------

type BacklogOpener = Extract<ManagerOpener, { type: 'new'; stage: 'backlog' }>;

function BacklogManagerView({
  opener,
  onClose,
}: {
  opener: BacklogOpener;
  onClose: () => void;
}) {
  const {
    slug,
    article,
    currentStatus: openerCurrentStatus,
    currentBacklogRow,
    sources: openerSources,
    litSearchRuns: openerLitSearchRuns,
    initialComments,
    initialNotes,
    categoryLookup,
    viewerEmail,
    onStatusChange,
    onPipelineActionTriggered,
    onPrev,
    onNext,
    position,
  } = opener;
  const router = useRouter();
  const [notes, setNotes] = useState<string>(initialNotes);
  const [pendingNotes, setPendingNotes] = useState<string>(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [resetting, setResetting] = useState(false);
  const notesDirty = pendingNotes !== notes;

  // The DS Modal doesn't lock body scroll, so wheel events that don't get
  // absorbed by the modal's own scroll container chain up to the page.
  // Lock body overflow while the modal is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Read modal state directly from the opener props. The parent already
  // runs PB subscriptions (via `useApprovalState`) AND polls
  // `router.refresh()` on pipeline actions, so the props it passes are
  // always fresh — and the snapshotToken-based reseed inside our own
  // `useLiveCollection` calls used to silently fail when PB's `updated`
  // string didn't visibly change between refreshes, freezing the badge.
  // Reading the props directly eliminates that failure mode entirely.
  const currentStatus = currentBacklogRow?.status ?? openerCurrentStatus;
  const sources = openerSources;
  const litSearchSnapshot = useMemo(
    () => deriveLitSearchSnapshot(openerLitSearchRuns ?? []),
    [openerLitSearchRuns],
  );
  const isLitSearchRunning = litSearchSnapshot.inFlight.has(article.articleKey);

  // The article's real phase, derived from the persisted status.
  const actualPhase = phaseFromStatus(currentStatus);
  // The phase the editor is *looking at*. Defaults to actual phase but
  // can be dragged backwards by chip clicks (pure navigation — no PB
  // write). When the article advances (lit-search completes, writer
  // finishes, or the editor re-runs an earlier phase), the effect below
  // pulls viewedPhase forward so the panel follows.
  const [viewedPhase, setViewedPhase] = useState<ArticleManagerPhase>(actualPhase);
  useEffect(() => {
    setViewedPhase(actualPhase);
  }, [actualPhase]);

  async function pickStatus(next: ArticleBacklogStatus) {
    // Persist any dirty notes with the same status write so the user
    // doesn't have to click two buttons.
    await onStatusChange(next, notesDirty ? pendingNotes : undefined);
    if (notesDirty) setNotes(pendingNotes);
  }

  async function saveNotesOnly() {
    if (!notesDirty || savingNotes) return;
    setSavingNotes(true);
    try {
      await onStatusChange(currentStatus, pendingNotes);
      setNotes(pendingNotes);
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <Modal
      header={article.articleTitle ?? 'Manage article'}
      subHeader={`Currently: ${STATUS_LABEL[currentStatus]}`}
      isFullScreen
      isDismissible
      onAction={() => onClose()}
      privateProps={{ height: '90vh' }}
      closeButtonAriaLabel="Close manager"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <SharedHeader
            title={article.articleTitle ?? '(untitled)'}
            decisionBadge={{
              text: STATUS_LABEL[currentStatus],
              color: STATUS_COLOR[currentStatus],
            }}
            decisionBadgeNode={
              isLitSearchRunning ? <LitSearchProgressBadge /> : undefined
            }
            metaInline={
              <Inline space="s">
                {article.articleType && (
                  <Text size="xs" color="secondary">
                    Type: {article.articleType}
                  </Text>
                )}
                <Text size="xs" color="secondary">
                  # Codes: {article.codes.length}
                </Text>
                <Text size="xs" color="secondary">
                  # Sources: {article.sourcesCount}
                </Text>
              </Inline>
            }
          />

          {article.codes.length > 0 && (
            <Stack space="xs">
              <Text size="s" weight="bold">
                Codes ({article.codes.length})
              </Text>
              <CodeChipList codes={article.codes} categoryLookup={categoryLookup} />
            </Stack>
          )}

          <Stepper
            actualPhase={actualPhase}
            viewedPhase={viewedPhase}
            onPick={setViewedPhase}
          />
          <PhaseBody
            phase={viewedPhase}
            status={currentStatus}
            sources={sources}
            litSearchRuns={openerLitSearchRuns ?? []}
            slug={slug}
            articleKey={article.articleKey}
            articleRecordId={article.id}
            articleTitle={article.articleTitle ?? ''}
            viewerEmail={viewerEmail}
            onAdvance={pickStatus}
            onPipelineActionTriggered={onPipelineActionTriggered}
          />

          <DecisionNoteField
            value={pendingNotes}
            onChange={setPendingNotes}
            placeholder="Status note (optional — saved with the next status change, or via Save note)"
          />
          {notesDirty && (
            <Inline space="s">
              <Button
                variant="secondary"
                size="s"
                onClick={saveNotesOnly}
                disabled={savingNotes}
              >
                {savingNotes ? 'Saving…' : 'Save note'}
              </Button>
              <Button
                variant="tertiary"
                size="s"
                onClick={() => setPendingNotes(notes)}
                disabled={savingNotes}
              >
                Revert
              </Button>
            </Inline>
          )}

          <CommentsSection
            slug={slug}
            recordKind="article"
            recordKey={article.articleKey}
            recordId={article.id}
            initialComments={initialComments}
            viewerEmail={viewerEmail}
          />

          <div
            style={{
              marginTop: 8,
              paddingTop: 16,
              borderTop: '1px solid rgba(0, 0, 0, 0.08)',
            }}
          >
            <Stack space="xs">
              <Text size="xs" color="secondary" weight="bold">
                Danger zone
              </Text>
              <Inline space="s" vAlignItems="center">
                <button
                  type="button"
                  disabled={resetting}
                  onClick={async () => {
                    if (resetting) return;
                    const ok = window.confirm(
                      `Reset "${article.articleTitle ?? '(untitled)'}" to a blank slate?\n\n` +
                        `This deletes ALL sources, comments, draft runs, ` +
                        `and draft outputs for this article. The article ` +
                        `stays approved and remains in your backlog at ` +
                        `the "Search sources" phase.\n\n` +
                        `This cannot be undone.`,
                    );
                    if (!ok) return;
                    setResetting(true);
                    try {
                      await resetArticle(slug, article.articleKey, article.id);
                      // Pulse the parent's polling window. A single
                      // `router.refresh()` here used to race the
                      // `revalidatePath` cache commit and sometimes pulled
                      // the pre-reset snapshot; the parent pulse fires an
                      // immediate refresh AND polls for 30s, so the modal
                      // header badge + the backlog table row both catch
                      // up without a manual reload. Keep the modal open
                      // so the user sees the article is still here, just
                      // back at phase 1.
                      if (onPipelineActionTriggered) {
                        onPipelineActionTriggered();
                      } else {
                        router.refresh();
                      }
                      setResetting(false);
                    } catch (e) {
                      console.error('[reset-article] failed', e);
                      setResetting(false);
                      window.alert(
                        `Reset failed: ${e instanceof Error ? e.message : String(e)}`,
                      );
                    }
                  }}
                  style={{
                    background: 'white',
                    color: 'rgb(180, 30, 30)',
                    border: '1px solid rgb(220, 160, 160)',
                    padding: '6px 12px',
                    borderRadius: 4,
                    fontSize: 13,
                    cursor: resetting ? 'wait' : 'pointer',
                    opacity: resetting ? 0.6 : 1,
                  }}
                >
                  {resetting ? 'Resetting…' : 'Reset article'}
                </button>
                <Text size="xs" color="secondary">
                  Wipes sources, comments, and drafts. Keeps the article approved and in
                  your backlog.
                </Text>
              </Inline>
            </Stack>
          </div>
        </div>
        {(onPrev || onNext) && (
          <div style={footerStyle}>
            <Button variant="tertiary" onClick={onPrev} disabled={!onPrev}>
              ← Prev
            </Button>
            <Button variant="tertiary" onClick={onNext} disabled={!onNext}>
              Next →
            </Button>
            {position && (
              <Text size="xs" color="secondary">
                {position.index + 1} / {position.total}
              </Text>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Shared chrome — header (title + stage badge + decision badge + meta inline)
// and the decision-rationale notes input.
// ---------------------------------------------------------------------------

type BadgeColor = 'gray' | 'green' | 'yellow' | 'red' | 'purple' | 'blue' | 'brand';

function SharedHeader({
  title,
  stageBadge,
  decisionBadge,
  decisionBadgeNode,
  extraBadges,
  metaInline,
}: {
  title: string;
  /** Optional stage indicator. Backlog views omit this (the modal already
   *  scopes by surface; no need for a redundant "Backlog" badge). Review
   *  views still pass it so editors see they're in the review surface. */
  stageBadge?: { text: string; color: BadgeColor };
  decisionBadge: { text: string; color: BadgeColor; tooltip?: string } | null;
  /** Live ReactNode override for the decision badge slot. Takes precedence
   *  over `decisionBadge` when present — used so the backlog modal can
   *  swap in `<LitSearchProgressBadge />` while the lit-search worker is
   *  running, without re-implementing the badge layout. */
  decisionBadgeNode?: React.ReactNode;
  extraBadges?: Array<{ text: string; color: BadgeColor }>;
  metaInline?: React.ReactNode;
}) {
  return (
    <Stack space="s">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          {title}
        </Text>
        {stageBadge ? <Badge text={stageBadge.text} color={stageBadge.color} /> : null}
        {extraBadges?.map((b) => (
          <Badge key={b.text} text={b.text} color={b.color} />
        ))}
        {decisionBadgeNode
          ? decisionBadgeNode
          : decisionBadge &&
            (decisionBadge.tooltip ? (
              <span title={decisionBadge.tooltip}>
                <Badge text={decisionBadge.text} color={decisionBadge.color} />
              </span>
            ) : (
              <Badge text={decisionBadge.text} color={decisionBadge.color} />
            ))}
      </Inline>
      {metaInline}
    </Stack>
  );
}

function DecisionNoteField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <Stack space="xs">
      <Text size="s" weight="bold">
        Decision note
      </Text>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{
          width: '100%',
          padding: 8,
          fontFamily: 'inherit',
          fontSize: 14,
          borderRadius: 4,
          border: '1px solid rgba(0, 0, 0, 0.15)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Backlog stage support — Stepper, StepBody, SourcesTable (extracted from
// the old article-manager-modal.tsx with no behavior change).
// ---------------------------------------------------------------------------

const SOURCE_TYPE_LABEL: Record<string, string> = {
  guideline: 'Guideline',
  systematic_review: 'Systematic review',
  clinical_review: 'Clinical review',
  meta_analysis: 'Meta-analysis',
  case_report: 'Case report',
  vet_content: 'Vet content',
  non_english: 'Non-English',
  other: 'Other',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9em',
  tableLayout: 'fixed',
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid rgb(220, 220, 225)',
  borderRight: '1px solid var(--ads-c-divider, rgba(0, 0, 0, 0.08))',
  padding: '8px 6px',
  fontWeight: 600,
  color: 'rgb(70, 70, 80)',
  background: 'rgb(248, 248, 250)',
  position: 'sticky',
  top: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};
const tdStyle: CSSProperties = {
  borderBottom: '1px solid rgb(238, 238, 242)',
  borderRight: '1px solid var(--ads-c-divider, rgba(0, 0, 0, 0.08))',
  padding: '8px 6px',
  verticalAlign: 'top',
  overflow: 'hidden',
  wordBreak: 'break-word',
};

const footerStyle: CSSProperties = {
  flex: 'none',
  borderTop: '1px solid rgba(0, 0, 0, 0.12)',
  padding: '10px 0',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

type SourceColumn = {
  key: string;
  label: string;
  initialWidth: number;
  /** Defaults to true. The trailing decision column and the leading drag
   *  handle don't get a resize grip. */
  resizable?: boolean;
};

const MIN_COL_WIDTH = 32;

function ResizableHeader({
  column,
  onResize,
}: {
  column: SourceColumn;
  onResize: (width: number) => void;
}) {
  const thRef = useRef<HTMLTableCellElement | null>(null);
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = thRef.current?.getBoundingClientRect().width ?? MIN_COL_WIDTH;
      const move = (ev: MouseEvent) => {
        onResize(startWidth + (ev.clientX - startX));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [onResize],
  );
  const resizable = column.resizable !== false;
  return (
    <th ref={thRef} style={{ ...thStyle, position: 'sticky', top: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {column.label}
        </span>
        {resizable ? (
          <span
            onMouseDown={onMouseDown}
            style={{
              width: 6,
              flex: 'none',
              cursor: 'col-resize',
              alignSelf: 'stretch',
              marginRight: -6,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </th>
  );
}

function SourcesTable({
  sources,
  slug,
  viewerEmail,
  mode,
}: {
  sources: ArticleSourceRecord[];
  slug: string;
  viewerEmail?: string;
  mode: 'curation' | 'priority';
}) {
  // Local order is the source of truth for the priority view so DnD
  // feels immediate; reconciled with props when the modal's live
  // subscription emits a fresh row set.
  const [order, setOrder] = useState<string[]>(() => sources.map((s) => s.id));
  useEffect(() => {
    setOrder(sources.map((s) => s.id));
  }, [sources]);

  const byId = useMemo(() => {
    const m: Record<string, ArticleSourceRecord> = {};
    for (const s of sources) m[s.id] = s;
    return m;
  }, [sources]);

  const ordered =
    mode === 'priority' ? order.map((id) => byId[id]).filter(Boolean) : sources;

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  // Column widths are persisted per mode (curation vs priority) so the
  // two views remember their own layouts independently.
  const widthsStorageKey = `sources-table:widths:${mode}`;
  const [widths, setWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(widthsStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_COL_WIDTH) {
            cleaned[k] = v;
          }
        }
        setWidths(cleaned);
      }
    } catch {
      /* corrupt blob — ignore */
    }
  }, [widthsStorageKey]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Object.keys(widths).length === 0) return;
    try {
      window.localStorage.setItem(widthsStorageKey, JSON.stringify(widths));
    } catch {
      /* quota or disabled — silent */
    }
  }, [widths, widthsStorageKey]);

  const onDrop = useCallback(async () => {
    if (!dragId || !dropId || dragId === dropId) {
      setDragId(null);
      setDropId(null);
      return;
    }
    const from = order.indexOf(dragId);
    const to = order.indexOf(dropId);
    if (from === -1 || to === -1) return;
    const next = order.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setOrder(next);
    setDragId(null);
    setDropId(null);
    try {
      await submitSourcesOrder(slug, next);
    } catch (e) {
      console.error('[sources-order] submit failed', e);
    }
  }, [dragId, dropId, order, slug]);

  if (sources.length === 0) {
    return (
      <Stack space="s">
        <Text>
          {mode === 'priority'
            ? 'No approved sources yet — approve sources in the previous step.'
            : 'No sources attached yet.'}
        </Text>
        {mode === 'curation' ? (
          <Text size="s" color="secondary">
            Run the Literature search card on the Pipeline tab to fetch PubMed candidates
            for every article still waiting for sources.
          </Text>
        ) : null}
      </Stack>
    );
  }

  const columnList: SourceColumn[] =
    mode === 'priority'
      ? [
          { key: 'drag', label: '', initialWidth: 28, resizable: false },
          { key: 'sourceId', label: 'Source ID', initialWidth: 160 },
          { key: 'title', label: 'Title', initialWidth: 320 },
          { key: 'type', label: 'Type', initialWidth: 140 },
          { key: 'journal', label: 'Journal', initialWidth: 220 },
          { key: 'url', label: 'URL', initialWidth: 160 },
          { key: 'doi', label: 'DOI', initialWidth: 180 },
          { key: 'notes', label: 'Notes', initialWidth: 220 },
          { key: 'decision', label: 'Decision', initialWidth: 110, resizable: false },
        ]
      : [
          { key: 'title', label: 'Title', initialWidth: 360 },
          { key: 'type', label: 'Type', initialWidth: 140 },
          { key: 'journal', label: 'Journal', initialWidth: 240 },
          { key: 'url', label: 'URL', initialWidth: 160 },
          { key: 'doi', label: 'DOI', initialWidth: 200 },
          { key: 'notes', label: 'Notes', initialWidth: 220 },
          { key: 'decision', label: 'Decision', initialWidth: 110, resizable: false },
        ];

  return (
    <div
      style={{
        maxHeight: '40vh',
        overflow: 'auto',
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
      <table style={tableStyle}>
        <colgroup>
          {columnList.map((c) => (
            <col key={c.key} style={{ width: widths[c.key] ?? c.initialWidth }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columnList.map((c) => (
              <ResizableHeader
                key={c.key}
                column={c}
                onResize={(next) =>
                  setWidths((w) => ({ ...w, [c.key]: Math.max(MIN_COL_WIDTH, next) }))
                }
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => {
            const isDragging = dragId === s.id;
            const isDropTarget = dropId === s.id && dragId !== s.id;
            return (
              <tr
                key={s.id}
                onDragOver={(e) => {
                  if (mode !== 'priority' || !dragId) return;
                  e.preventDefault();
                  if (dropId !== s.id) setDropId(s.id);
                }}
                onDrop={(e) => {
                  if (mode !== 'priority') return;
                  e.preventDefault();
                  void onDrop();
                }}
                style={{
                  opacity: isDragging ? 0.4 : 1,
                  boxShadow: isDropTarget ? 'inset 0 2px 0 rgb(59, 130, 246)' : undefined,
                }}
              >
                {mode === 'priority' ? (
                  <>
                    <td
                      style={{ ...tdStyle, textAlign: 'center', cursor: 'grab' }}
                      draggable
                      onDragStart={() => setDragId(s.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropId(null);
                      }}
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                    >
                      ≡
                    </td>
                    <td style={tdStyle}>
                      <SourceIdCell source={s} slug={slug} />
                    </td>
                  </>
                ) : null}
                <td style={tdStyle}>
                  <Text weight="bold">{s.title}</Text>
                  {s.llmSummary ? (
                    <Text size="xs" color="secondary">
                      {s.llmSummary}
                    </Text>
                  ) : null}
                </td>
                <td style={tdStyle}>
                  {s.sourceType ? (
                    <Badge
                      text={SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}
                      color="blue"
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td style={tdStyle}>
                  {s.journal ?? '—'}
                  {s.journalNlm ? (
                    <Text size="xs" color="secondary">
                      {s.journalNlm}
                    </Text>
                  ) : null}
                </td>
                <td style={tdStyle}>
                  <SourceUrlCell source={s} slug={slug} />
                </td>
                <td style={tdStyle}>
                  <SourceDoiCell source={s} slug={slug} />
                </td>
                <td style={tdStyle}>
                  <SourceNotesCell source={s} slug={slug} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <SourceDecisionCell source={s} slug={slug} viewerEmail={viewerEmail} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceIdCell({ source, slug }: { source: ArticleSourceRecord; slug: string }) {
  const [value, setValue] = useState<string>(source.cortexSourceId ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.cortexSourceId ?? '');
  }, [source.cortexSourceId]);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.cortexSourceId ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceCortexId(slug, source.id, trimmed);
    } catch (e) {
      console.error('[source-id] submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.cortexSourceId, slug]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void persist()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      disabled={submitting}
      placeholder="Paste source ID"
      style={{
        width: '100%',
        padding: '4px 6px',
        fontSize: 12,
        border: '1px solid rgba(0, 0, 0, 0.15)',
        borderRadius: 4,
        background: '#fff',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    />
  );
}

// Borderless input that looks like plain text in the cell. The browser's
// native focus ring marks the active field; cursor switches to text on
// hover so the affordance is discoverable.
const editableInputStyle: CSSProperties = {
  width: '100%',
  padding: '2px 4px',
  fontSize: 'inherit',
  fontFamily: 'inherit',
  color: 'inherit',
  border: '1px solid transparent',
  borderRadius: 3,
  background: 'transparent',
};

const openLinkStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 3,
  textDecoration: 'none',
  fontSize: 12,
  lineHeight: 1,
  color: 'inherit',
  opacity: 0.6,
};

function SourceUrlCell({ source, slug }: { source: ArticleSourceRecord; slug: string }) {
  const [value, setValue] = useState<string>(source.url ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.url ?? '');
  }, [source.url]);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.url ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceUrl(slug, source.id, trimmed);
    } catch (e) {
      console.error('[source-url] submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.url, slug]);

  const trimmed = value.trim();
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={submitting}
        placeholder="Paste URL"
        style={editableInputStyle}
      />
      {trimmed && isSafeUrl(trimmed) && (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          title="Open URL"
          style={openLinkStyle}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function SourceDoiCell({ source, slug }: { source: ArticleSourceRecord; slug: string }) {
  const [value, setValue] = useState<string>(source.doi ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.doi ?? '');
  }, [source.doi]);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.doi ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceDoi(slug, source.id, trimmed);
    } catch (e) {
      console.error('[source-doi] submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.doi, slug]);

  const trimmed = value.trim();
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={submitting}
        placeholder="Paste DOI"
        style={editableInputStyle}
      />
      {trimmed && (
        <a
          href={`https://doi.org/${trimmed}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open DOI"
          style={openLinkStyle}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function SourceNotesCell({
  source,
  slug,
}: {
  source: ArticleSourceRecord;
  slug: string;
}) {
  const [value, setValue] = useState<string>(source.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.notes ?? '');
  }, [source.notes]);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.notes ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceNotes(slug, source.id, trimmed);
    } catch (e) {
      console.error('[source-notes] submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.notes, slug]);

  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void persist()}
      onKeyDown={(e) => {
        // Enter saves and blurs; Shift+Enter inserts a newline so editors
        // can write multi-line notes.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      disabled={submitting}
      placeholder="Add note…"
      rows={2}
      style={{
        ...editableInputStyle,
        resize: 'vertical',
        minHeight: 36,
        lineHeight: 1.4,
      }}
    />
  );
}

function SourceDecisionCell({
  source,
  slug,
  viewerEmail,
}: {
  source: ArticleSourceRecord;
  slug: string;
  viewerEmail?: string;
}) {
  const [status, setStatus] = useState<SourceReviewStatus | null>(
    source.reviewStatus ?? null,
  );
  const [submitting, setSubmitting] = useState(false);

  // Reconcile with the parent's live source row — the modal subscribes
  // to `articleSources` via useLiveCollection, so an update from another
  // tab or a server-side flip propagates through props.
  useEffect(() => {
    setStatus(source.reviewStatus ?? null);
  }, [source.reviewStatus]);

  const toggle = useCallback(
    async (target: SourceReviewStatus) => {
      if (submitting) return;
      const next = status === target ? null : target;
      setSubmitting(true);
      setStatus(next);
      try {
        await submitSourceReview(slug, source.id, next);
      } catch (e) {
        setStatus(source.reviewStatus ?? null);
        console.error('[source-review] submit failed', e);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, status, slug, source.id, source.reviewStatus],
  );

  const reviewerHandle = source.reviewerEmail ? source.reviewerEmail.split('@')[0] : '';
  const stamp = source.reviewedAt ? new Date(source.reviewedAt).toLocaleString() : '';
  const approveTitle =
    status === 'approved' && reviewerHandle
      ? `Approved by ${reviewerHandle}${stamp ? ` · ${stamp}` : ''}`
      : 'Approve source';
  const rejectTitle =
    status === 'rejected' && reviewerHandle
      ? `Rejected by ${reviewerHandle}${stamp ? ` · ${stamp}` : ''}`
      : 'Reject source';

  return (
    <Inline space="xxs" vAlignItems="center">
      <button
        type="button"
        style={decideButton(status === 'approved', 'approve')}
        title={approveTitle}
        disabled={submitting}
        onClick={() => toggle('approved')}
        aria-label={approveTitle}
      >
        ✓
      </button>
      <button
        type="button"
        style={decideButton(status === 'rejected', 'reject')}
        title={rejectTitle}
        disabled={submitting}
        onClick={() => toggle('rejected')}
        aria-label={rejectTitle}
      >
        ✗
      </button>
      {viewerEmail ? null : null}
    </Inline>
  );
}

const stepButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid rgb(210, 210, 215)',
  borderRadius: 999,
  padding: '4px 10px',
  background: 'white',
  color: 'rgb(40, 40, 50)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.85em',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

const circleBase: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.75em',
  fontWeight: 600,
};

const PHASES: ArticleManagerPhase[] = [1, 2, 3, 4, 5, 6, 7];

function DraftPreview({
  slug,
  articleRecordId,
}: {
  slug: string;
  articleRecordId: string;
}) {
  type State =
    | { kind: 'loading' }
    | { kind: 'empty' }
    | { kind: 'ready'; pass: string; output: string; finishedAt?: number }
    | { kind: 'error'; message: string };
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    getLatestDraftForArticle(slug, articleRecordId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setState({ kind: 'empty' });
          return;
        }
        setState({
          kind: 'ready',
          pass: d.pass,
          output: d.output,
          finishedAt: d.finishedAt,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setState({ kind: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, articleRecordId]);

  if (state.kind === 'loading') {
    return (
      <Text size="s" color="secondary">
        Loading draft…
      </Text>
    );
  }
  if (state.kind === 'error') {
    return (
      <Text size="s" color="error">
        Failed to load draft: {state.message}
      </Text>
    );
  }
  if (state.kind === 'empty') {
    return (
      <Text size="s" color="secondary">
        No completed draft yet.
      </Text>
    );
  }
  return (
    <Stack space="xs">
      <Text size="xs" color="secondary">
        Pass: {state.pass}
        {state.finishedAt ? ` · ${new Date(state.finishedAt).toLocaleString()}` : ''}
      </Text>
      <div
        style={{
          maxHeight: '50vh',
          overflow: 'auto',
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 6,
          padding: 16,
          background: 'white',
          fontSize: 14,
          lineHeight: 1.5,
        }}
        // Output is HTML from our own LLM pipeline; not user input. v1
        // skips sanitization. If risk concerns surface later, wrap with
        // DOMPurify.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted internal LLM output
        dangerouslySetInnerHTML={{ __html: state.output }}
      />
    </Stack>
  );
}

function Stepper({
  actualPhase,
  viewedPhase,
  onPick,
}: {
  actualPhase: ArticleManagerPhase;
  viewedPhase: ArticleManagerPhase;
  onPick: (phase: ArticleManagerPhase) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        rowGap: 8,
        alignItems: 'center',
      }}
    >
      {PHASES.map((phase) => {
        const isCurrent = phase === actualPhase;
        const isCompleted = phase < actualPhase;
        const isFuture = phase > actualPhase;
        // The viewed-but-not-current cue: a 2px amber outline on whichever
        // past chip the user is parked on. Lets them see "I'm looking at
        // approval, even though the article is in editing".
        const isViewed = phase === viewedPhase && viewedPhase !== actualPhase;
        const buttonStyle: CSSProperties = {
          ...stepButtonBase,
          background: isCurrent ? 'rgb(255, 248, 230)' : 'white',
          borderColor: isCurrent
            ? 'rgb(217, 119, 6)'
            : isCompleted
              ? 'rgb(34, 139, 80)'
              : 'rgb(210, 210, 215)',
          color: isCurrent
            ? 'rgb(120, 70, 0)'
            : isCompleted
              ? 'rgb(15, 95, 50)'
              : 'rgb(140, 140, 150)',
          fontWeight: isCurrent ? 600 : 400,
          cursor: isFuture ? 'not-allowed' : 'pointer',
          opacity: isFuture ? 0.6 : 1,
          outline: isViewed ? '2px solid rgb(217, 119, 6)' : 'none',
          outlineOffset: isViewed ? 2 : 0,
        };
        const circleStyle: CSSProperties = {
          ...circleBase,
          background: isCompleted
            ? 'rgb(34, 139, 80)'
            : isCurrent
              ? 'rgb(217, 119, 6)'
              : 'rgb(230, 230, 235)',
          color: isCompleted || isCurrent ? 'white' : 'rgb(140, 140, 150)',
        };
        return (
          <button
            key={phase}
            type="button"
            onClick={() => {
              if (isFuture) return;
              onPick(phase);
            }}
            style={buttonStyle}
            aria-current={isCurrent ? 'step' : undefined}
            aria-disabled={isFuture}
            title={PHASE_LABEL[phase]}
          >
            <span style={circleStyle}>{isCompleted ? '✓' : phase}</span>
            <span>{PHASE_LABEL[phase]}</span>
          </button>
        );
      })}
    </div>
  );
}

const PHASE_COPY: Record<ArticleManagerPhase, string> = {
  1: 'No sources fetched yet. Run a literature search to gather and rank candidates from Gemini web search, PubMed, and Google Scholar for this article.',
  2: 'The LLM ranked these sources. Approve the ones to keep and reject the rest — then advance to prioritize.',
  3: 'Drag to reorder by priority. Paste the Cortex Source ID for every approved source — the draft step needs all of them.',
  4: 'Article draft is being generated. The dispatcher runs up to 3 articles concurrently.',
  5: "Preview the latest draft. When you've finished editing in Cortex, mark the article ready to publish.",
  6: 'Final QC check before publishing. Mark as published when the article is live.',
  7: 'Article is published.',
};

function PhaseBody({
  phase,
  status,
  sources,
  litSearchRuns,
  slug,
  articleKey,
  articleRecordId,
  articleTitle,
  viewerEmail,
  onAdvance,
  onPipelineActionTriggered,
}: {
  /** The phase the user is *viewing* — drives which panel renders. May lag
   *  behind `status` when the editor has chip-navigated to an earlier
   *  phase to review/redo it. */
  phase: ArticleManagerPhase;
  /** The article's *real* status — drives the in-panel action gates
   *  (`canRunLitSearch`, `canDraft`). A phase-1 view of a phase-5 article
   *  shows the copy but no run button, because the lit-search route would
   *  no-op anyway. */
  status: ArticleBacklogStatus;
  sources: ArticleSourceRecord[];
  litSearchRuns: ArticleLitSearchRunRecord[];
  slug: string;
  articleKey: string;
  articleRecordId: string;
  articleTitle: string;
  viewerEmail?: string;
  onAdvance: (next: ArticleBacklogStatus) => void;
  onPipelineActionTriggered?: () => void;
}) {
  const copy = PHASE_COPY[phase];
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  if (phase === 1) {
    const litEligible = canRunLitSearch(status, sources.length);
    if (litEligible) {
      return (
        <LitSearchPhase1Panel
          slug={slug}
          articleKey={articleKey}
          articleRecordId={articleRecordId}
          copy={copy}
          initialRuns={litSearchRuns}
          onTriggered={onPipelineActionTriggered}
        />
      );
    }
    return (
      <Stack space="m">
        <Text color="secondary">
          {`Literature search already ran for this article — ${sources.length} candidate${sources.length === 1 ? '' : 's'} retrieved. Use the chips above to step forward through the pipeline.`}
        </Text>
      </Stack>
    );
  }

  if (phase === 2) {
    const approveEnabled = canApproveSources(sources);
    return (
      <Stack space="m">
        <Text color="secondary">{copy}</Text>
        <SourcesTable
          sources={sources}
          slug={slug}
          viewerEmail={viewerEmail}
          mode="curation"
        />
        <Inline space="s" vAlignItems="center">
          <Button
            variant="primary"
            size="s"
            disabled={!approveEnabled}
            onClick={() => onAdvance('sources-approved')}
          >
            Approve sources
          </Button>
          {!approveEnabled ? (
            <Text size="xs" color="secondary">
              Approve at least one source to continue.
            </Text>
          ) : null}
        </Inline>
      </Stack>
    );
  }

  if (phase === 3) {
    const visible = sources
      .filter((s) => s.reviewStatus === 'approved')
      .slice()
      .sort(
        (a, b) =>
          (a.priority ?? Number.POSITIVE_INFINITY) -
          (b.priority ?? Number.POSITIVE_INFINITY),
      );
    const draftReady = canStartDraft(sources);
    const missingIds = missingCortexIdCount(sources);
    return (
      <Stack space="m">
        <Text color="secondary">{copy}</Text>
        <SourcesTable
          sources={visible}
          slug={slug}
          viewerEmail={viewerEmail}
          mode="priority"
        />
        <Inline space="s" vAlignItems="center">
          <Button
            variant="primary"
            size="s"
            disabled={!draftReady}
            onClick={() => onAdvance('ready-for-llm-draft')}
          >
            Ready to draft
          </Button>
          <Button
            variant="secondary"
            size="s"
            leftIcon="plus"
            onClick={() => setAddSourceOpen(true)}
          >
            Add source
          </Button>
          {!draftReady ? (
            <Text size="xs" color="secondary">
              {missingIds > 0
                ? `Paste Source IDs for ${missingIds} more source${missingIds === 1 ? '' : 's'} to continue.`
                : 'Approve at least one source to continue.'}
            </Text>
          ) : null}
        </Inline>
        <AddSourceModal
          open={addSourceOpen}
          slug={slug}
          articleKey={articleKey}
          articleRecordId={articleRecordId}
          onClose={() => setAddSourceOpen(false)}
        />
      </Stack>
    );
  }

  if (phase === 4) {
    return (
      <Stack space="m">
        <Text color="secondary">{copy}</Text>
        {canDraft(status) ? (
          <Inline space="s" vAlignItems="center">
            <DraftArticleButton
              slug={slug}
              articleRecordId={articleRecordId}
              articleKey={articleKey}
              articleTitle={articleTitle}
              sources={sources}
              hasSources={sources.length > 0}
              viewerEmail={viewerEmail}
              initialRun={null}
            />
          </Inline>
        ) : null}
      </Stack>
    );
  }

  // Phases 5, 6, 7 — preview the latest draft + advance buttons.
  return (
    <Stack space="m">
      <Text color="secondary">{copy}</Text>
      <DraftPreview slug={slug} articleRecordId={articleRecordId} />
      {phase === 5 ? (
        <Inline space="s" vAlignItems="center">
          <Button
            variant="primary"
            size="s"
            onClick={() => onAdvance('ready-to-publish')}
          >
            Mark ready to publish
          </Button>
        </Inline>
      ) : null}
      {phase === 6 ? (
        <Inline space="s" vAlignItems="center">
          <Button variant="primary" size="s" onClick={() => onAdvance('published')}>
            Mark published
          </Button>
        </Inline>
      ) : null}
    </Stack>
  );
}

// ===========================================================================
// type='update' · stage='review-*' — Per-section + per-article review surface
// for article-update suggestions. Ported from the legacy SectionReviewModal
// with a SharedHeader, a per-section decision-note textarea, and the same
// section/article view toggle.
// ===========================================================================

const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';

type UpdateReviewOpener = Extract<
  ManagerOpener,
  { type: 'update'; stage: 'review-1st' | 'review-2nd' }
>;

type SortedSectionRow = SectionRow & {
  /** Always set — review pass only operates on rows that have a PB id. */
  id: string;
  bucket: string;
};

function sortSectionsForReview(rows: SectionRow[]): SortedSectionRow[] {
  const out: SortedSectionRow[] = [];
  for (const r of rows) {
    if (!r.id) continue;
    out.push({ ...r, id: r.id, bucket: r.articleTitle ?? '(no article)' });
  }
  out.sort((a, b) => {
    if (a.bucket === '(no article)' && b.bucket !== '(no article)') return 1;
    if (a.bucket !== '(no article)' && b.bucket === '(no article)') return -1;
    const c = a.bucket.localeCompare(b.bucket);
    if (c !== 0) return c;
    return (b.overallImportance ?? -Infinity) - (a.overallImportance ?? -Infinity);
  });
  return out;
}

function UpdateReviewView({
  opener,
  onClose,
}: {
  opener: UpdateReviewOpener;
  onClose: () => void;
}) {
  const {
    slug,
    sections,
    startAtId,
    initialViewMode,
    initialReviews,
    initialReviewers,
    initialCommentsBySection,
    initialCommentsByParentArticle,
    initialNotesBySection,
    categoryLookup,
    titleOriginLookup,
    viewerEmail,
    onDecideSection,
  } = opener;

  const sorted = useMemo(() => sortSectionsForReview(sections), [sections]);
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewers, setReviewers] = useState<ReviewerMap>(initialReviewers);
  const [notesByKey, setNotesByKey] =
    useState<Record<string, string>>(initialNotesBySection);
  useEffect(() => {
    setReviews(initialReviews);
    setReviewers(initialReviewers);
    setNotesByKey(initialNotesBySection);
  }, [initialReviews, initialReviewers, initialNotesBySection]);
  const [index, setIndex] = useState(() => {
    if (startAtId) {
      const at = sorted.findIndex((r) => r.id === startAtId);
      if (at !== -1) return at;
    }
    const firstUnreviewed = sorted.findIndex((r) => !initialReviews[r.sectionKey ?? '']);
    return firstUnreviewed === -1 ? 0 : firstUnreviewed;
  });
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'section' | 'article'>(
    initialViewMode ?? 'section',
  );

  const total = sorted.length;
  const current = sorted[index];

  const articles = useMemo(() => {
    const seen = new Set<string>();
    const out: { bucket: string; firstIndex: number }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i].bucket;
      if (seen.has(b)) continue;
      seen.add(b);
      out.push({ bucket: b, firstIndex: i });
    }
    return out;
  }, [sorted]);

  const currentArticleIndex = current
    ? articles.findIndex((a) => a.bucket === current.bucket)
    : -1;
  const articleSections = current
    ? sorted.filter((r) => r.bucket === current.bucket)
    : [];

  const bucketStats = useMemo(() => {
    if (!current) return null;
    const inBucket = articleSections;
    const seen = inBucket.findIndex((r) => r.id === current.id);
    const approved = inBucket.filter(
      (r) => reviews[r.sectionKey ?? ''] === 'approved',
    ).length;
    const rejected = inBucket.filter(
      (r) => reviews[r.sectionKey ?? ''] === 'rejected',
    ).length;
    return {
      bucketSize: inBucket.length,
      indexInBucket: seen + 1,
      approved,
      rejected,
      unreviewed: inBucket.length - approved - rejected,
    };
  }, [current, articleSections, reviews]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: closures over latest state via listed deps.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          if (e.key === 'Escape') onClose();
          return;
        }
      }
      if (submitting) return;
      if (viewMode === 'article') {
        if (e.key === 'ArrowRight') goNextArticle();
        else if (e.key === 'ArrowLeft') goPrevArticle();
        else if (e.key === 'Escape') onClose();
        return;
      }
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'a' || e.key === 'A' || e.key === 'y' || e.key === 'Y') {
        decide('approved');
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'n' || e.key === 'N') {
        decide('rejected');
      } else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, total, current?.id, submitting, viewMode, currentArticleIndex]);

  function goNext() {
    setIndex((i) => Math.min(total - 1, i + 1));
  }
  function goPrev() {
    setIndex((i) => Math.max(0, i - 1));
  }
  function goNextArticle() {
    if (currentArticleIndex < articles.length - 1) {
      setIndex(articles[currentArticleIndex + 1].firstIndex);
    }
  }
  function goPrevArticle() {
    if (currentArticleIndex > 0) {
      setIndex(articles[currentArticleIndex - 1].firstIndex);
    }
  }

  function sectionKeyOf(rowId: string): string {
    const row = sorted.find((r) => r.id === rowId);
    return row?.sectionKey ?? '';
  }

  async function setRowStatus(rowId: string, status: ReviewStatus, notes?: string) {
    const sectionKey = sectionKeyOf(rowId);
    if (!sectionKey) {
      // Surface as a UI banner — silently bailing here is what made the
      // per-row ✓/✗ appear broken when a section row landed without a
      // computed sectionKey (older fixture data or a partial re-run).
      setReviewError("Couldn't approve: section is missing its stable key.");
      return;
    }
    setReviewError(null);
    setSubmitting(true);
    // Modal-local snappy UI; parent's `useApprovalState` hook is fed
    // through `onDecideSection` (optimistic patch + server action +
    // rollback on failure).
    const next: ReviewMap = { ...reviews, [sectionKey]: status };
    const nextReviewers: ReviewerMap = {
      ...reviewers,
      [sectionKey]: { reviewerEmail: viewerEmail, reviewedAt: Date.now() },
    };
    setReviews(next);
    setReviewers(nextReviewers);
    try {
      await onDecideSection(sectionKey, rowId, status, notes);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
      const revertedReviews = { ...reviews };
      const revertedReviewers = { ...reviewers };
      delete revertedReviews[sectionKey];
      delete revertedReviewers[sectionKey];
      setReviews(revertedReviews);
      setReviewers(revertedReviewers);
    } finally {
      setSubmitting(false);
    }
  }

  async function clearRowStatus(rowId: string) {
    const sectionKey = sectionKeyOf(rowId);
    if (!sectionKey) return;
    setReviewError(null);
    setSubmitting(true);
    const next = { ...reviews };
    const nextReviewers = { ...reviewers };
    delete next[sectionKey];
    delete nextReviewers[sectionKey];
    setReviews(next);
    setReviewers(nextReviewers);
    try {
      await onDecideSection(sectionKey, rowId, null);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleApproveRow(rowId: string) {
    const sectionKey = sectionKeyOf(rowId);
    if (sectionKey && reviews[sectionKey] === 'approved') void clearRowStatus(rowId);
    else void setRowStatus(rowId, 'approved');
  }
  function toggleRejectRow(rowId: string) {
    const sectionKey = sectionKeyOf(rowId);
    if (sectionKey && reviews[sectionKey] === 'rejected') void clearRowStatus(rowId);
    else void setRowStatus(rowId, 'rejected');
  }

  async function decide(status: ReviewStatus) {
    if (!current) return;
    const rowId = current.id;
    const notesValue = notesByKey[current.sectionKey ?? ''] ?? '';
    await setRowStatus(rowId, status, notesValue);
    if (index < total - 1) goNext();
  }

  async function clearDecision() {
    if (!current) return;
    await clearRowStatus(current.id);
  }

  if (!current) {
    return (
      <Modal
        header="Review article updates"
        size="m"
        onAction={() => onClose()}
        actionButton={{ text: 'Close', onClick: onClose }}
      >
        <Modal.Text>No sections to review.</Modal.Text>
      </Modal>
    );
  }

  const currentKey = current.sectionKey ?? '';
  const currentStatus = reviews[currentKey];
  const previousNames = (current as SectionRow & { previousSectionNames?: string[] })
    .previousSectionNames;
  const currentNotes = notesByKey[currentKey] ?? '';

  const headerText =
    viewMode === 'article'
      ? `Manage article update · Article ${currentArticleIndex + 1} of ${articles.length}`
      : `Manage section update · ${index + 1} of ${total}`;
  const subHeaderText =
    viewMode === 'article'
      ? `${current.bucket} · ${bucketStats?.bucketSize ?? 0} sections · ${bucketStats?.approved ?? 0} approved · ${bucketStats?.rejected ?? 0} rejected · ${bucketStats?.unreviewed ?? 0} unreviewed`
      : `${current.bucket} — ${bucketStats?.indexInBucket}/${bucketStats?.bucketSize} in article · ${bucketStats?.approved} approved · ${bucketStats?.rejected} rejected · ${bucketStats?.unreviewed} unreviewed`;

  const stageBadge: { text: string; color: BadgeColor } = {
    text: 'Review',
    color: 'gray',
  };
  const updateChip: { text: string; color: BadgeColor } | null =
    current.updateType === 'new'
      ? { text: 'new section', color: 'blue' }
      : current.updateType === 'update'
        ? { text: 'section update', color: 'purple' }
        : null;

  return (
    <Modal
      header={headerText}
      subHeader={subHeaderText}
      size="l"
      isDismissible
      isFullScreen={viewMode === 'article'}
      isMaxWidthLimit={viewMode === 'section'}
      onAction={() => onClose()}
      privateProps={{ height: '90vh' }}
      closeButtonAriaLabel="Close manager"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <Inline space="s" vAlignItems="center">
            <SegmentedControl
              label="Review view"
              isLabelHidden
              value={viewMode}
              onChange={(v) => setViewMode(v === 'article' ? 'article' : 'section')}
              size="s"
              options={[
                { name: 'view', value: 'section', label: 'Per section' },
                { name: 'view', value: 'article', label: 'Per article' },
              ]}
            />
          </Inline>

          {reviewError ? (
            <button
              type="button"
              onClick={() => setReviewError(null)}
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
              {reviewError}
            </button>
          ) : null}

          {viewMode === 'section' ? (
            <>
              <SharedHeader
                title={current.sectionName ?? '(untitled section)'}
                stageBadge={stageBadge}
                extraBadges={updateChip ? [updateChip] : []}
                decisionBadge={
                  currentStatus === 'approved'
                    ? {
                        text: 'approved',
                        color: 'green',
                        tooltip: reviewerLabel(reviewers[currentKey], 'approved'),
                      }
                    : currentStatus === 'rejected'
                      ? {
                          text: 'rejected',
                          color: 'red',
                          tooltip: reviewerLabel(reviewers[currentKey], 'rejected'),
                        }
                      : null
                }
                metaInline={
                  <Inline space="s">
                    {current.articleTitle && (
                      <Text size="xs" color="secondary">
                        Parent article: {current.articleTitle}
                      </Text>
                    )}
                    {current.articleId && (
                      <Text size="xs" color="secondary">
                        ID: {current.articleId}
                      </Text>
                    )}
                    {typeof current.overallImportance === 'number' && (
                      <Text size="xs" color="secondary">
                        Importance: {current.overallImportance}
                      </Text>
                    )}
                    {typeof current.overallCoverage === 'number' && (
                      <Text size="xs" color="secondary">
                        Coverage: {current.overallCoverage}
                      </Text>
                    )}
                    <Text size="xs" color="secondary">
                      # Codes: {current.numCodes}
                    </Text>
                  </Inline>
                }
              />

              <Stack space="xs">
                <Text size="s" weight="bold">
                  Codes ({current.codes.length})
                </Text>
                <CodeChipList codes={current.codes} categoryLookup={categoryLookup} />
              </Stack>

              {previousNames && previousNames.length > 0 && (
                <Stack space="xs">
                  <Text size="s" weight="bold">
                    Previous names
                  </Text>
                  {Array.from(new Set(previousNames)).map((t) => {
                    const origin = titleOriginLookup[t];
                    const formatted =
                      origin?.kind === 'section' || origin?.kind === 'both'
                        ? `(${origin.inArticle}: ${t})`
                        : origin?.kind === 'article'
                          ? `(article: ${t})`
                          : t;
                    return (
                      <Text key={t} size="xs">
                        · {formatted}
                      </Text>
                    );
                  })}
                </Stack>
              )}

              {current.justification && (
                <Stack space="xs">
                  <Text size="s" weight="bold">
                    Justification
                  </Text>
                  <Text size="s" color="secondary">
                    {current.justification}
                  </Text>
                </Stack>
              )}

              <DecisionNoteField
                value={currentNotes}
                onChange={(v) => setNotesByKey((prev) => ({ ...prev, [currentKey]: v }))}
                placeholder="Decision rationale (optional — saved when you approve or reject)"
              />

              <CommentsSection
                key={current.id}
                slug={slug}
                recordKind="section"
                recordKey={current.sectionKey ?? ''}
                recordId={current.id}
                initialComments={initialCommentsBySection[current.sectionKey ?? ''] ?? []}
                viewerEmail={viewerEmail}
              />
            </>
          ) : (
            <UpdateArticleViewBody
              articleSections={articleSections}
              articleKey={current.articleId ?? current.articleTitle ?? '_'}
              parentTitle={current.articleTitle ?? '(no article)'}
              stageBadge={stageBadge}
              reviews={reviews}
              reviewers={reviewers}
              categoryLookup={categoryLookup}
              submitting={submitting}
              onApprove={toggleApproveRow}
              onReject={toggleRejectRow}
              slug={slug}
              initialComments={
                initialCommentsByParentArticle[
                  current.articleId ?? current.articleTitle ?? '_'
                ] ?? []
              }
              viewerEmail={viewerEmail}
            />
          )}
        </div>

        <div style={footerStyle}>
          {viewMode === 'section' ? (
            <>
              <Button
                variant="tertiary"
                onClick={goPrev}
                disabled={index === 0 || submitting}
              >
                ← Prev
              </Button>
              <Button
                variant="tertiary"
                onClick={goNext}
                disabled={index === total - 1 || submitting}
              >
                Skip / Next →
              </Button>
              <span style={{ flex: 1 }} />
              {currentStatus && (
                <Button variant="tertiary" onClick={clearDecision} disabled={submitting}>
                  Clear decision
                </Button>
              )}
              <Button
                variant="secondary"
                destructive
                onClick={() => decide('rejected')}
                disabled={submitting}
              >
                Reject (R)
              </Button>
              <Button
                variant="primary"
                onClick={() => decide('approved')}
                disabled={submitting}
              >
                Approve (A)
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="tertiary"
                onClick={goPrevArticle}
                disabled={currentArticleIndex <= 0 || submitting}
              >
                ← Prev article
              </Button>
              <Button
                variant="tertiary"
                onClick={goNextArticle}
                disabled={currentArticleIndex === articles.length - 1 || submitting}
              >
                Next article →
              </Button>
              <span style={{ flex: 1 }} />
              <Text size="xs" color="secondary">
                Use the per-row ✓ / ✗ to decide each section.
              </Text>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Per-article body for the update-review surface — small hand-built table
// of all sections in the current article, each with inline ✓ / ✗ toggles.
// ---------------------------------------------------------------------------

const sectionCellStyle: CSSProperties = {
  padding: '8px 10px',
  borderTop: '1px solid rgba(0, 0, 0, 0.06)',
  verticalAlign: 'middle',
  fontSize: 13,
  textAlign: 'left',
};

const sectionHeadStyle: CSSProperties = {
  ...sectionCellStyle,
  borderTop: 'none',
  borderBottom: '1px solid rgba(0, 0, 0, 0.12)',
  background: 'rgba(0, 0, 0, 0.03)',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'rgb(70, 70, 80)',
  whiteSpace: 'nowrap',
};

const decideButtonBase: CSSProperties = {
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

function decideButton(active: boolean, kind: 'approve' | 'reject'): CSSProperties {
  if (!active) return decideButtonBase;
  if (kind === 'approve') {
    return {
      ...decideButtonBase,
      background: 'rgb(16, 185, 129)',
      borderColor: 'rgb(16, 185, 129)',
      color: '#fff',
    };
  }
  return {
    ...decideButtonBase,
    background: 'rgb(220, 38, 38)',
    borderColor: 'rgb(220, 38, 38)',
    color: '#fff',
  };
}

function UpdateArticleViewBody({
  articleSections,
  articleKey,
  parentTitle,
  stageBadge,
  reviews,
  reviewers,
  categoryLookup,
  submitting,
  onApprove,
  onReject,
  slug,
  initialComments,
  viewerEmail,
}: {
  articleSections: SortedSectionRow[];
  articleKey: string;
  parentTitle: string;
  stageBadge: { text: string; color: BadgeColor };
  reviews: ReviewMap;
  reviewers: ReviewerMap;
  categoryLookup: CategoryLookup;
  submitting: boolean;
  onApprove: (rowId: string) => void;
  onReject: (rowId: string) => void;
  slug: string;
  initialComments: ReviewCommentRecord[];
  viewerEmail?: string;
}) {
  const approved = articleSections.filter(
    (s) => reviews[s.sectionKey ?? ''] === 'approved',
  ).length;
  const rejected = articleSections.filter(
    (s) => reviews[s.sectionKey ?? ''] === 'rejected',
  ).length;
  return (
    <>
      <SharedHeader
        title={parentTitle}
        stageBadge={stageBadge}
        decisionBadge={null}
        metaInline={
          <Inline space="s">
            <Text size="xs" color="secondary">
              {articleSections.length} section{articleSections.length === 1 ? '' : 's'}
            </Text>
            <Text size="xs" color="secondary">
              {approved} approved
            </Text>
            <Text size="xs" color="secondary">
              {rejected} rejected
            </Text>
          </Inline>
        }
      />
      <div
        style={{
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 6,
          overflow: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={sectionHeadStyle}>Section title</th>
              <th style={{ ...sectionHeadStyle, width: 90 }}>Update type</th>
              <th style={sectionHeadStyle}>Codes</th>
              <th style={{ ...sectionHeadStyle, width: 90, textAlign: 'center' }}>
                Importance
              </th>
              <th style={{ ...sectionHeadStyle, width: 90, textAlign: 'center' }}>
                Coverage
              </th>
              <th style={sectionHeadStyle}>Justification</th>
              <th style={{ ...sectionHeadStyle, width: 80, textAlign: 'center' }}>
                Decision
              </th>
            </tr>
          </thead>
          <tbody>
            {articleSections.map((s) => {
              const sectionKey = s.sectionKey ?? '';
              const status = reviews[sectionKey];
              const tint =
                status === 'approved'
                  ? APPROVED_TINT
                  : status === 'rejected'
                    ? REJECTED_TINT
                    : 'transparent';
              return (
                <tr key={s.id} style={{ background: tint }}>
                  <td style={sectionCellStyle}>{s.sectionName ?? '—'}</td>
                  <td style={sectionCellStyle}>
                    {s.updateType === 'new' ? (
                      <Badge text="new" color="blue" />
                    ) : s.updateType === 'update' ? (
                      <Badge text="update" color="purple" />
                    ) : (
                      <Text size="xs" color="secondary">
                        —
                      </Text>
                    )}
                  </td>
                  <td style={sectionCellStyle}>
                    <CodeChipList codes={s.codes} categoryLookup={categoryLookup} />
                  </td>
                  <td style={{ ...sectionCellStyle, textAlign: 'center' }}>
                    {s.overallImportance ?? '—'}
                  </td>
                  <td style={{ ...sectionCellStyle, textAlign: 'center' }}>
                    {s.overallCoverage ?? '—'}
                  </td>
                  <td style={sectionCellStyle}>
                    <Text size="xs" color="secondary">
                      {s.justification ?? ''}
                    </Text>
                  </td>
                  <td style={{ ...sectionCellStyle, textAlign: 'center' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        gap: 4,
                        alignItems: 'center',
                      }}
                    >
                      <button
                        type="button"
                        title={
                          status === 'approved'
                            ? `${reviewerLabel(reviewers[sectionKey], 'approved')} — click to clear`
                            : 'Approve'
                        }
                        style={decideButton(status === 'approved', 'approve')}
                        disabled={submitting}
                        onClick={() => onApprove(s.id)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        title={
                          status === 'rejected'
                            ? `${reviewerLabel(reviewers[sectionKey], 'rejected')} — click to clear`
                            : 'Reject'
                        }
                        style={decideButton(status === 'rejected', 'reject')}
                        disabled={submitting}
                        onClick={() => onReject(s.id)}
                      >
                        ✗
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CommentsSection
        key={articleKey}
        slug={slug}
        recordKind="article"
        recordKey={`upd::${articleKey}`}
        recordId={articleKey}
        initialComments={initialComments}
        viewerEmail={viewerEmail}
      />
    </>
  );
}

// ===========================================================================
// type='update' · stage='backlog' — Workflow surface for an article-update
// backlog row. Shows the parent article, the stepper, a list of approved
// section changes, comments (keyed on `pa:` prefix to share thread with the
// update-review article view), and a decision note.
// ===========================================================================

type BacklogUpdateOpener = Extract<ManagerOpener, { type: 'update'; stage: 'backlog' }>;

function BacklogUpdateView({
  opener,
  onClose,
}: {
  opener: BacklogUpdateOpener;
  onClose: () => void;
}) {
  const {
    slug,
    article,
    sections,
    currentStatus: openerCurrentStatus,
    currentBacklogRow,
    initialComments,
    initialNotes,
    categoryLookup,
    viewerEmail,
    onStatusChange,
    onPrev,
    onNext,
    position,
  } = opener;

  // Read status directly from the opener prop — same reasoning as the
  // new-article view above. The parent's polling pulse keeps these props
  // fresh; the previous self-contained useLiveCollection added a stale
  // snapshotToken layer that masked legitimate updates.
  const currentStatus = currentBacklogRow?.status ?? openerCurrentStatus;

  const [notes, setNotes] = useState<string>(initialNotes);
  const [pendingNotes, setPendingNotes] = useState<string>(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const notesDirty = pendingNotes !== notes;

  // See BacklogManagerView — DS Modal doesn't lock body scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Stepper is purely visual here (no PhaseBody) — chip clicks just park
  // viewedPhase locally. They never flip the persisted status.
  const actualPhase = phaseFromStatus(currentStatus);
  const [viewedPhase, setViewedPhase] = useState<ArticleManagerPhase>(actualPhase);
  useEffect(() => {
    setViewedPhase(actualPhase);
  }, [actualPhase]);

  async function saveNotesOnly() {
    if (!notesDirty || savingNotes) return;
    setSavingNotes(true);
    try {
      await onStatusChange(currentStatus, pendingNotes);
      setNotes(pendingNotes);
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <Modal
      header={article.articleTitle ?? 'Manage article update'}
      subHeader={`Currently: ${STATUS_LABEL[currentStatus]}`}
      size="l"
      isDismissible
      onAction={() => onClose()}
      privateProps={{ height: '90vh' }}
      closeButtonAriaLabel="Close manager"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <SharedHeader
            title={article.articleTitle ?? '(untitled)'}
            decisionBadge={{
              text: STATUS_LABEL[currentStatus],
              color: STATUS_COLOR[currentStatus],
            }}
            metaInline={
              <Inline space="s">
                <Text size="xs" color="secondary">
                  {sections.length} approved section
                  {sections.length === 1 ? '' : 's'}
                </Text>
              </Inline>
            }
          />

          <Stepper
            actualPhase={actualPhase}
            viewedPhase={viewedPhase}
            onPick={setViewedPhase}
          />

          <Stack space="xs">
            <Text size="s" weight="bold">
              Approved section changes ({sections.length})
            </Text>
            <ApprovedSectionsTable sections={sections} categoryLookup={categoryLookup} />
          </Stack>

          <DecisionNoteField
            value={pendingNotes}
            onChange={setPendingNotes}
            placeholder="Status note (optional — saved with the next status change, or via Save note)"
          />
          {notesDirty && (
            <Inline space="s">
              <Button
                variant="secondary"
                size="s"
                onClick={saveNotesOnly}
                disabled={savingNotes}
              >
                {savingNotes ? 'Saving…' : 'Save note'}
              </Button>
              <Button
                variant="tertiary"
                size="s"
                onClick={() => setPendingNotes(notes)}
                disabled={savingNotes}
              >
                Revert
              </Button>
            </Inline>
          )}

          <CommentsSection
            slug={slug}
            recordKind="article"
            recordKey={article.articleKey}
            recordId={article.id}
            initialComments={initialComments}
            viewerEmail={viewerEmail}
          />
        </div>
        {(onPrev || onNext) && (
          <div style={footerStyle}>
            <Button variant="tertiary" onClick={onPrev} disabled={!onPrev}>
              ← Prev
            </Button>
            <Button variant="tertiary" onClick={onNext} disabled={!onNext}>
              Next →
            </Button>
            {position && (
              <Text size="xs" color="secondary">
                {position.index + 1} / {position.total}
              </Text>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ApprovedSectionsTable({
  sections,
  categoryLookup,
}: {
  sections: SectionRow[];
  categoryLookup: CategoryLookup;
}) {
  if (sections.length === 0) {
    return (
      <Text size="s" color="secondary">
        No approved section changes yet.
      </Text>
    );
  }
  return (
    <div
      style={{
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 6,
        overflow: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={sectionHeadStyle}>Section title</th>
            <th style={{ ...sectionHeadStyle, width: 90 }}>Update type</th>
            <th style={sectionHeadStyle}>Codes</th>
            <th style={sectionHeadStyle}>Justification</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s, i) => (
            // Stable key precedence: sectionKey is content-derived so it
            // varies even when two sections share `sectionName`. Falls back
            // to PB id, then array index — never to sectionName, which is
            // not unique (e.g. two articles with a "Diagnosis" section).
            <tr key={s.sectionKey ?? s.id ?? `row-${i}`}>
              <td style={sectionCellStyle}>{s.sectionName ?? '—'}</td>
              <td style={sectionCellStyle}>
                {s.updateType === 'new' ? (
                  <Badge text="new" color="blue" />
                ) : s.updateType === 'update' ? (
                  <Badge text="update" color="purple" />
                ) : (
                  <Text size="xs" color="secondary">
                    —
                  </Text>
                )}
              </td>
              <td style={sectionCellStyle}>
                <CodeChipList codes={s.codes} categoryLookup={categoryLookup} />
              </td>
              <td style={sectionCellStyle}>
                <Text size="xs" color="secondary">
                  {s.justification ?? ''}
                </Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
