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
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type {
  ArticleBacklogStatus,
  ArticleSourceRecord,
  PredatoryJournalRisk,
  ReviewCommentRecord,
} from '@/lib/pb/types';
import {
  resetArticleReview,
  resetSectionReview,
  submitArticleReview,
  submitSectionReview,
} from '../[specialty]/actions';
import type { ArticleRow } from './articles-view';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_OPTIONS,
  statusToStepValue,
} from './backlog-constants';
import type { BacklogRow } from './backlog-view';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, TitleOriginLookup } from './code-utils';
import { CommentsSection } from './comments-section';
import type { SectionRow } from './sections-view';

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
      onReviewsChange: (next: ReviewMap) => void;
      onReviewersChange: (next: ReviewerMap) => void;
    }
  | {
      type: 'new';
      stage: 'backlog';
      slug: string;
      article: BacklogRow;
      currentStatus: ArticleBacklogStatus;
      sources: ArticleSourceRecord[];
      initialComments: ReviewCommentRecord[];
      initialNotes: string;
      categoryLookup: CategoryLookup;
      viewerEmail?: string;
      onStatusChange: (
        next: ArticleBacklogStatus,
        notes?: string,
      ) => void | Promise<void>;
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
      onReviewsChange: (next: ReviewMap) => void;
      onReviewersChange: (next: ReviewerMap) => void;
    }
  | {
      type: 'update';
      stage: 'backlog';
      slug: string;
      article: BacklogRow;
      sections: SectionRow[];
      currentStatus: ArticleBacklogStatus;
      initialComments: ReviewCommentRecord[];
      initialNotes: string;
      categoryLookup: CategoryLookup;
      viewerEmail?: string;
      onStatusChange: (
        next: ArticleBacklogStatus,
        notes?: string,
      ) => void | Promise<void>;
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
    onReviewsChange,
    onReviewersChange,
  } = opener;

  const sorted = useMemo(() => sortForReview(articles), [articles]);
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewers, setReviewers] = useState<ReviewerMap>(initialReviewers);
  const [notesById, setNotesById] =
    useState<Record<string, string>>(initialNotesByArticle);
  const [index, setIndex] = useState(() => {
    if (startAtId) {
      const at = sorted.findIndex((r) => r.id === startAtId);
      if (at !== -1) return at;
    }
    const firstUnreviewed = sorted.findIndex((r) => !initialReviews[r.id]);
    return firstUnreviewed === -1 ? 0 : firstUnreviewed;
  });
  const [submitting, setSubmitting] = useState(false);

  const total = sorted.length;
  const current = sorted[index];

  const bucketStats = useMemo(() => {
    if (!current) return null;
    const inBucket = sorted.filter((r) => r.category === current.category);
    const seen = inBucket.findIndex((r) => r.id === current.id);
    const approved = inBucket.filter((r) => reviews[r.id] === 'approved').length;
    const rejected = inBucket.filter((r) => reviews[r.id] === 'rejected').length;
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
    const notesValue = notesById[rowId] ?? '';
    setSubmitting(true);
    const next: ReviewMap = { ...reviews, [rowId]: status };
    const nextReviewers: ReviewerMap = {
      ...reviewers,
      [rowId]: { reviewerEmail: viewerEmail, reviewedAt: Date.now() },
    };
    setReviews(next);
    setReviewers(nextReviewers);
    onReviewsChange(next);
    onReviewersChange(nextReviewers);
    try {
      await submitArticleReview(slug, articleKey, rowId, status, notesValue);
    } catch (err) {
      console.error('submitArticleReview failed', err);
      const revertedReviews = { ...reviews };
      const revertedReviewers = { ...reviewers };
      delete revertedReviews[rowId];
      delete revertedReviewers[rowId];
      setReviews(revertedReviews);
      setReviewers(revertedReviewers);
      onReviewsChange(revertedReviews);
      onReviewersChange(revertedReviewers);
    } finally {
      setSubmitting(false);
      if (index < total - 1) goNext();
    }
  }

  async function clearDecision() {
    if (!current) return;
    const rowId = current.id;
    const articleKey = current.articleKey ?? '';
    if (!articleKey) return;
    setSubmitting(true);
    const next = { ...reviews };
    const nextReviewers = { ...reviewers };
    delete next[rowId];
    delete nextReviewers[rowId];
    setReviews(next);
    setReviewers(nextReviewers);
    onReviewsChange(next);
    onReviewersChange(nextReviewers);
    try {
      await resetArticleReview(slug, articleKey);
    } catch (err) {
      console.error('resetArticleReview failed', err);
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

  const currentStatus = reviews[current.id];
  const previousTitles = (
    current as ArticleRow & { previousArticleTitleSuggestions?: string[] }
  ).previousArticleTitleSuggestions;
  const currentNotes = notesById[current.id] ?? '';

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
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <SharedHeader
            title={current.articleTitle ?? '(untitled)'}
            stageBadge={
              opener.stage === 'review-1st'
                ? { text: '1st pass', color: 'gray' }
                : { text: '2nd pass', color: 'gray' }
            }
            decisionBadge={
              currentStatus === 'approved'
                ? {
                    text: 'approved',
                    color: 'green',
                    tooltip: reviewerLabel(reviewers[current.id], 'approved'),
                  }
                : currentStatus === 'rejected'
                  ? {
                      text: 'rejected',
                      color: 'red',
                      tooltip: reviewerLabel(reviewers[current.id], 'rejected'),
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
              {previousTitles.map((t) => {
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
            onChange={(v) => setNotesById((prev) => ({ ...prev, [current.id]: v }))}
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
    currentStatus,
    sources,
    initialComments,
    initialNotes,
    categoryLookup,
    viewerEmail,
    onStatusChange,
  } = opener;
  const [notes, setNotes] = useState<string>(initialNotes);
  const [pendingNotes, setPendingNotes] = useState<string>(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const notesDirty = pendingNotes !== notes;

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
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <SharedHeader
            title={article.articleTitle ?? '(untitled)'}
            stageBadge={{ text: 'Backlog', color: 'blue' }}
            decisionBadge={{
              text: STATUS_LABEL[currentStatus],
              color: STATUS_COLOR[currentStatus],
            }}
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

          <Stepper current={currentStatus} onPick={pickStatus} />
          <StepBody status={currentStatus} sources={sources} />

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
  extraBadges,
  metaInline,
}: {
  title: string;
  stageBadge: { text: string; color: BadgeColor };
  decisionBadge: { text: string; color: BadgeColor; tooltip?: string } | null;
  extraBadges?: Array<{ text: string; color: BadgeColor }>;
  metaInline?: React.ReactNode;
}) {
  return (
    <Stack space="s">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          {title}
        </Text>
        <Badge text={stageBadge.text} color={stageBadge.color} />
        {extraBadges?.map((b) => (
          <Badge key={b.text} text={b.text} color={b.color} />
        ))}
        {decisionBadge &&
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

const RISK_COLOR: Record<PredatoryJournalRisk, BadgeColor> = {
  none: 'green',
  low: 'gray',
  medium: 'yellow',
  high: 'red',
  predatory: 'purple',
};

const STEP_COPY: Record<ArticleBacklogStatus, string> = {
  unassigned: 'This article is waiting for the first literature search.',
  'waiting-for-sources':
    'No sources fetched yet. Run the Literature search card on the Pipeline tab to fetch and rank PubMed candidates for every article in this state.',
  'sources-searched':
    'PubMed ranked these sources for this article. Review the list and move to "Sources approved" once you\'re satisfied.',
  'sources-approved':
    'The source list is locked in. Next: upload the source PDFs to Cortex CMS, then mark this article as ready for the LLM draft.',
  'ready-for-llm-draft':
    'Sources are in Cortex. Trigger article-draft generation when ready (coming in a follow-up). Once the draft is back, move this article to "Ready for editing".',
  'ready-for-editing':
    'The LLM draft is in Cortex CMS. Open it there to start editing. When you begin, move this article to "Editing in progress".',
  'editing-in-progress':
    'Editing is happening in Cortex CMS. When the article is ready for a final pass, move it to "Ready to publish".',
  'ready-to-publish':
    'Final review checklist (coming in a follow-up). When done, mark this article as "Published".',
  published: 'This article has been published.',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9em',
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid rgb(220, 220, 225)',
  padding: '8px 6px',
  fontWeight: 600,
  color: 'rgb(70, 70, 80)',
  background: 'rgb(248, 248, 250)',
  position: 'sticky',
  top: 0,
};
const tdStyle: CSSProperties = {
  borderBottom: '1px solid rgb(238, 238, 242)',
  padding: '8px 6px',
  verticalAlign: 'top',
};

const footerStyle: CSSProperties = {
  flex: 'none',
  borderTop: '1px solid rgba(0, 0, 0, 0.12)',
  padding: '10px 0',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

function SourcesTable({ sources }: { sources: ArticleSourceRecord[] }) {
  if (sources.length === 0) {
    return (
      <Stack space="s">
        <Text>No sources attached yet.</Text>
        <Text size="s" color="secondary">
          Run the Literature search card on the Pipeline tab to fetch PubMed candidates
          for every article still waiting for sources.
        </Text>
      </Stack>
    );
  }
  return (
    <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 50 }}>Use</th>
            <th style={{ ...thStyle, width: 60 }}>Rank</th>
            <th style={thStyle}>Title</th>
            <th style={{ ...thStyle, width: 130 }}>Type</th>
            <th style={thStyle}>Journal</th>
            <th style={{ ...thStyle, width: 110 }}>Risk</th>
            <th style={{ ...thStyle, width: 160 }}>DOI</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                {s.useFlag ? (
                  <Text as="span" size="s" weight="bold">
                    ✓
                  </Text>
                ) : (
                  <Text as="span" size="s" color="secondary">
                    ✗
                  </Text>
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{s.rank ?? '—'}</td>
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
                {s.predatoryJournalRisk ? (
                  <Badge
                    text={s.predatoryJournalRisk}
                    color={RISK_COLOR[s.predatoryJournalRisk]}
                  />
                ) : (
                  '—'
                )}
              </td>
              <td style={tdStyle}>
                {s.doi ? (
                  <a
                    href={`https://doi.org/${s.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ wordBreak: 'break-all' }}
                  >
                    {s.doi}
                  </a>
                ) : s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ wordBreak: 'break-all' }}
                  >
                    {s.url}
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type StepState = 'completed' | 'current' | 'upcoming';

function stepStateFor(stepIndex: number, currentIndex: number): StepState {
  if (stepIndex < currentIndex) return 'completed';
  if (stepIndex === currentIndex) return 'current';
  return 'upcoming';
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

function Stepper({
  current,
  onPick,
}: {
  current: ArticleBacklogStatus;
  onPick: (next: ArticleBacklogStatus) => void;
}) {
  const stepValue = statusToStepValue(current);
  const currentIndex = STATUS_OPTIONS.findIndex((s) => s.value === stepValue);

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
      {STATUS_OPTIONS.map((step, i) => {
        const state = stepStateFor(i, currentIndex < 0 ? 0 : currentIndex);
        const isCurrent = state === 'current';
        const isCompleted = state === 'completed';
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
              : 'rgb(90, 90, 100)',
          fontWeight: isCurrent ? 600 : 400,
        };
        const circleStyle: CSSProperties = {
          ...circleBase,
          background: isCompleted
            ? 'rgb(34, 139, 80)'
            : isCurrent
              ? 'rgb(217, 119, 6)'
              : 'rgb(230, 230, 235)',
          color: isCompleted || isCurrent ? 'white' : 'rgb(90, 90, 100)',
        };
        return (
          <button
            key={step.value}
            type="button"
            onClick={() => onPick(step.value)}
            style={buttonStyle}
            aria-current={isCurrent ? 'step' : undefined}
            title={step.label}
          >
            <span style={circleStyle}>{isCompleted ? '✓' : i + 1}</span>
            <span>{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function StepBody({
  status,
  sources,
}: {
  status: ArticleBacklogStatus;
  sources: ArticleSourceRecord[];
}) {
  const copy = STEP_COPY[status];
  if (status === 'sources-searched' || status === 'sources-approved') {
    return (
      <Stack space="m">
        <Text color="secondary">{copy}</Text>
        {status === 'sources-approved' ? (
          <Inline space="s" vAlignItems="center">
            <Badge text="Sources approved" color="green" />
            <Text size="s" color="secondary">
              {sources.length} source{sources.length === 1 ? '' : 's'} locked in
            </Text>
          </Inline>
        ) : null}
        <SourcesTable sources={sources} />
      </Stack>
    );
  }
  return (
    <Stack space="s">
      <Text>{copy}</Text>
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
    onReviewsChange,
    onReviewersChange,
  } = opener;

  const sorted = useMemo(() => sortSectionsForReview(sections), [sections]);
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewers, setReviewers] = useState<ReviewerMap>(initialReviewers);
  const [notesById, setNotesById] =
    useState<Record<string, string>>(initialNotesBySection);
  const [index, setIndex] = useState(() => {
    if (startAtId) {
      const at = sorted.findIndex((r) => r.id === startAtId);
      if (at !== -1) return at;
    }
    const firstUnreviewed = sorted.findIndex((r) => !initialReviews[r.id]);
    return firstUnreviewed === -1 ? 0 : firstUnreviewed;
  });
  const [submitting, setSubmitting] = useState(false);
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
    const approved = inBucket.filter((r) => reviews[r.id] === 'approved').length;
    const rejected = inBucket.filter((r) => reviews[r.id] === 'rejected').length;
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
      console.error('setRowStatus: row has no sectionKey — cannot persist review');
      return;
    }
    setSubmitting(true);
    const next: ReviewMap = { ...reviews, [rowId]: status };
    const nextReviewers: ReviewerMap = {
      ...reviewers,
      [rowId]: { reviewerEmail: viewerEmail, reviewedAt: Date.now() },
    };
    setReviews(next);
    setReviewers(nextReviewers);
    onReviewsChange(next);
    onReviewersChange(nextReviewers);
    try {
      await submitSectionReview(slug, sectionKey, rowId, status, notes);
    } catch (err) {
      console.error('submitSectionReview failed', err);
      const revertedReviews = { ...reviews };
      const revertedReviewers = { ...reviewers };
      delete revertedReviews[rowId];
      delete revertedReviewers[rowId];
      setReviews(revertedReviews);
      setReviewers(revertedReviewers);
      onReviewsChange(revertedReviews);
      onReviewersChange(revertedReviewers);
    } finally {
      setSubmitting(false);
    }
  }

  async function clearRowStatus(rowId: string) {
    const sectionKey = sectionKeyOf(rowId);
    if (!sectionKey) return;
    setSubmitting(true);
    const next = { ...reviews };
    const nextReviewers = { ...reviewers };
    delete next[rowId];
    delete nextReviewers[rowId];
    setReviews(next);
    setReviewers(nextReviewers);
    onReviewsChange(next);
    onReviewersChange(nextReviewers);
    try {
      await resetSectionReview(slug, sectionKey, rowId);
    } catch (err) {
      console.error('resetSectionReview failed', err);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleApproveRow(rowId: string) {
    if (reviews[rowId] === 'approved') void clearRowStatus(rowId);
    else void setRowStatus(rowId, 'approved');
  }
  function toggleRejectRow(rowId: string) {
    if (reviews[rowId] === 'rejected') void clearRowStatus(rowId);
    else void setRowStatus(rowId, 'rejected');
  }

  async function decide(status: ReviewStatus) {
    if (!current) return;
    const rowId = current.id;
    const notesValue = notesById[rowId] ?? '';
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

  const currentStatus = reviews[current.id];
  const previousNames = (current as SectionRow & { previousSectionNames?: string[] })
    .previousSectionNames;
  const currentNotes = notesById[current.id] ?? '';

  const headerText =
    viewMode === 'article'
      ? `Manage article update · Article ${currentArticleIndex + 1} of ${articles.length}`
      : `Manage section update · ${index + 1} of ${total}`;
  const subHeaderText =
    viewMode === 'article'
      ? `${current.bucket} · ${bucketStats?.bucketSize ?? 0} sections · ${bucketStats?.approved ?? 0} approved · ${bucketStats?.rejected ?? 0} rejected · ${bucketStats?.unreviewed ?? 0} unreviewed`
      : `${current.bucket} — ${bucketStats?.indexInBucket}/${bucketStats?.bucketSize} in article · ${bucketStats?.approved} approved · ${bucketStats?.rejected} rejected · ${bucketStats?.unreviewed} unreviewed`;

  const stageBadge: { text: string; color: BadgeColor } =
    opener.stage === 'review-1st'
      ? { text: '1st pass', color: 'gray' }
      : { text: '2nd pass', color: 'gray' };
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
                        tooltip: reviewerLabel(reviewers[current.id], 'approved'),
                      }
                    : currentStatus === 'rejected'
                      ? {
                          text: 'rejected',
                          color: 'red',
                          tooltip: reviewerLabel(reviewers[current.id], 'rejected'),
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
                  {previousNames.map((t) => {
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
                onChange={(v) => setNotesById((prev) => ({ ...prev, [current.id]: v }))}
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
  const approved = articleSections.filter((s) => reviews[s.id] === 'approved').length;
  const rejected = articleSections.filter((s) => reviews[s.id] === 'rejected').length;
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
              const status = reviews[s.id];
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
                            ? `${reviewerLabel(reviewers[s.id], 'approved')} — click to clear`
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
                            ? `${reviewerLabel(reviewers[s.id], 'rejected')} — click to clear`
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
    currentStatus,
    initialComments,
    initialNotes,
    categoryLookup,
    viewerEmail,
    onStatusChange,
  } = opener;

  const [notes, setNotes] = useState<string>(initialNotes);
  const [pendingNotes, setPendingNotes] = useState<string>(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const notesDirty = pendingNotes !== notes;

  async function pickStatus(next: ArticleBacklogStatus) {
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
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <SharedHeader
            title={article.articleTitle ?? '(untitled)'}
            stageBadge={{ text: 'Backlog · Update', color: 'purple' }}
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

          <Stepper current={currentStatus} onPick={pickStatus} />

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
          {sections.map((s) => (
            <tr key={s.id ?? s.sectionName}>
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
