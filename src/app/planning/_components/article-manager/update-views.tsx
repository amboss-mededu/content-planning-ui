'use client';

// Article-update surfaces: UpdateReviewView (+ per-article body) and
// BacklogUpdateView (+ Stepper, ApprovedSectionsTable). Extracted verbatim
// from article-manager-modal-v2.tsx.

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
import type { ReviewCommentRecord } from '@/lib/pb/types';
import {
  type ArticleManagerPhase,
  PHASE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from '../backlog-constants';
import { CodeChipList } from '../code-chip';
import type { CategoryLookup } from '../code-utils';
import { CommentsSection } from '../comments-section';
import { phaseFromStatus } from '../pipeline-stage-gates';
import type { SectionRow } from '../sections-view';
import {
  type BadgeColor,
  DecisionNoteField,
  decideButton,
  footerStyle,
  reviewerLabel,
  SharedHeader,
} from './shared';
import type {
  BacklogUpdateOpener,
  ReviewerMap,
  ReviewMap,
  ReviewStatus,
  UpdateReviewOpener,
} from './types';

const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';

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

export function UpdateReviewView({
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

export function BacklogUpdateView({
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
