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
import { useEffect, useMemo, useState } from 'react';
import type { ReviewCommentRecord } from '@/lib/pb/types';
import { resetSectionReview, submitSectionReview } from '../[specialty]/actions';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, TitleOriginLookup } from './code-utils';
import { CommentsSection } from './comments-section';
import {
  type ReviewerInfo,
  type ReviewerMap,
  type ReviewMap,
  type ReviewStatus,
  reviewerLabel,
} from './review-modal';
import type { SectionRow } from './sections-view';

type ViewMode = 'section' | 'article';

const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';

type SortedRow = SectionRow & {
  /** Always set — review pass operates only on rows that have a PB id. */
  id: string;
  bucket: string;
};

/** Sort sections into review order: alphabetical by parent article,
 *  then by importance desc within an article. Sections with no parent
 *  article fall into a synthetic "(no article)" bucket at the bottom. */
function sortForReview(rows: SectionRow[]): SortedRow[] {
  const out: SortedRow[] = [];
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

export function SectionReviewModal({
  slug,
  sections,
  startAtId,
  initialViewMode,
  initialReviews,
  initialReviewers,
  initialCommentsBySection,
  initialCommentsByParentArticle,
  categoryLookup,
  titleOriginLookup,
  viewerEmail,
  onClose,
  onReviewsChange,
  onReviewersChange,
}: {
  slug: string;
  sections: SectionRow[];
  /** Section id to seek to on open; falls back to first-unreviewed. */
  startAtId?: string;
  /** Initial view mode — defaults to per-section. Pass 'article' when
   *  opening from the grouped per-article view so the modal lands on
   *  the article overview instead of a single section. */
  initialViewMode?: ViewMode;
  initialReviews: ReviewMap;
  initialReviewers: ReviewerMap;
  initialCommentsBySection: Record<string, ReviewCommentRecord[]>;
  initialCommentsByParentArticle: Record<string, ReviewCommentRecord[]>;
  categoryLookup: CategoryLookup;
  titleOriginLookup: TitleOriginLookup;
  viewerEmail?: string;
  onClose: () => void;
  onReviewsChange: (next: ReviewMap) => void;
  onReviewersChange: (next: ReviewerMap) => void;
}) {
  const sorted = useMemo(() => sortForReview(sections), [sections]);
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewers, setReviewers] = useState<ReviewerMap>(initialReviewers);
  const [index, setIndex] = useState(() => {
    if (startAtId) {
      const at = sorted.findIndex((r) => r.id === startAtId);
      if (at !== -1) return at;
    }
    const firstUnreviewed = sorted.findIndex((r) => !initialReviews[r.id]);
    return firstUnreviewed === -1 ? 0 : firstUnreviewed;
  });
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode ?? 'section');

  const total = sorted.length;
  const current = sorted[index];

  // Distinct articles in review order, with a pointer to each one's first
  // section in `sorted`. Used to walk articles in the per-article view
  // without losing the underlying section index.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers close over latest state via the listed deps; adding decide/goNext/goPrev/onClose would re-bind every render.
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

  async function setRowStatus(rowId: string, status: ReviewStatus) {
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
      await submitSectionReview(slug, rowId, status);
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
      await resetSectionReview(slug, rowId);
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

  // Per-section decide (used by the section view's Approve/Reject buttons,
  // which auto-advance after recording).
  async function decide(status: ReviewStatus) {
    if (!current) return;
    const rowId = current.id;
    await setRowStatus(rowId, status);
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
  const previousNames = (
    current as SectionRow & {
      previousSectionNames?: string[];
    }
  ).previousSectionNames;

  const headerText =
    viewMode === 'article'
      ? `Review · Article ${currentArticleIndex + 1} of ${articles.length}`
      : `Review · ${index + 1} of ${total}`;
  const subHeaderText =
    viewMode === 'article'
      ? `${current.bucket} · ${bucketStats?.bucketSize ?? 0} sections · ${bucketStats?.approved ?? 0} approved · ${bucketStats?.rejected ?? 0} rejected · ${bucketStats?.unreviewed ?? 0} unreviewed`
      : `${current.bucket} — ${bucketStats?.indexInBucket}/${bucketStats?.bucketSize} in article · ${bucketStats?.approved} approved · ${bucketStats?.rejected} rejected · ${bucketStats?.unreviewed} unreviewed`;

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
      closeButtonAriaLabel="Close review"
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
            <SectionViewBody
              current={current}
              currentStatus={currentStatus}
              currentReviewer={reviewers[current.id]}
              previousNames={previousNames}
              titleOriginLookup={titleOriginLookup}
              categoryLookup={categoryLookup}
              slug={slug}
              initialComments={initialCommentsBySection[current.id] ?? []}
              viewerEmail={viewerEmail}
            />
          ) : (
            <ArticleViewBody
              articleSections={articleSections}
              articleKey={current.articleId ?? current.articleTitle ?? '_'}
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

        <div
          style={{
            flex: 'none',
            borderTop: '1px solid rgba(0, 0, 0, 0.12)',
            padding: '10px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
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
// Per-section view body — the original modal content, factored out so the
// modal frame can swap to the per-article body without re-mounting the
// shared header/footer.
// ---------------------------------------------------------------------------

function SectionViewBody({
  current,
  currentStatus,
  currentReviewer,
  previousNames,
  titleOriginLookup,
  categoryLookup,
  slug,
  initialComments,
  viewerEmail,
}: {
  current: SortedRow;
  currentStatus: ReviewStatus | undefined;
  currentReviewer: ReviewerInfo | undefined;
  previousNames: string[] | undefined;
  titleOriginLookup: TitleOriginLookup;
  categoryLookup: CategoryLookup;
  slug: string;
  initialComments: ReviewCommentRecord[];
  viewerEmail?: string;
}) {
  return (
    <>
      <Stack space="s">
        <Inline space="s" vAlignItems="center">
          <Text size="m" weight="bold">
            {current.sectionName ?? '(untitled section)'}
          </Text>
          {current.updateType === 'new' && <Badge text="new" color="blue" />}
          {current.updateType === 'update' && <Badge text="update" color="purple" />}
          {currentStatus === 'approved' && (
            <span title={reviewerLabel(currentReviewer, 'approved')}>
              <Badge text="approved" color="green" />
            </span>
          )}
          {currentStatus === 'rejected' && (
            <span title={reviewerLabel(currentReviewer, 'rejected')}>
              <Badge text="rejected" color="red" />
            </span>
          )}
        </Inline>
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
      </Stack>

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

      <CommentsSection
        key={current.id}
        slug={slug}
        recordKind="section"
        recordId={current.id}
        initialComments={initialComments}
        viewerEmail={viewerEmail}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-article view body — small custom table of all sections in the current
// article with inline ✓ / ✗ decision toggles per row. Hand-built table so
// the columns can be wide enough for the codes chip list and the justification
// without DataTable's filter/sort chrome (which doesn't add value when a
// single article has typically <30 sections).
// ---------------------------------------------------------------------------

const cellStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderTop: '1px solid rgba(0, 0, 0, 0.06)',
  verticalAlign: 'middle',
  fontSize: 13,
  textAlign: 'left',
};

const headStyle: React.CSSProperties = {
  ...cellStyle,
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

const decideButtonBase: React.CSSProperties = {
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

function decideButton(active: boolean, kind: 'approve' | 'reject') {
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

function ArticleViewBody({
  articleSections,
  articleKey,
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
  articleSections: SortedRow[];
  /** Stable key for the current AMBOSS article. Used as the
   *  `recordId` for per-article comments and as the React `key` so
   *  the comment thread re-mounts on article navigation. */
  articleKey: string;
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
  return (
    <>
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
              <th style={headStyle}>Section title</th>
              <th style={{ ...headStyle, width: 90 }}>Update type</th>
              <th style={headStyle}>Codes</th>
              <th style={{ ...headStyle, width: 90, textAlign: 'center' }}>Importance</th>
              <th style={{ ...headStyle, width: 90, textAlign: 'center' }}>Coverage</th>
              <th style={headStyle}>Justification</th>
              <th style={{ ...headStyle, width: 80, textAlign: 'center' }}>Decision</th>
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
                  <td style={cellStyle}>{s.sectionName ?? '—'}</td>
                  <td style={cellStyle}>
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
                  <td style={cellStyle}>
                    <CodeChipList codes={s.codes} categoryLookup={categoryLookup} />
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>
                    {s.overallImportance ?? '—'}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>
                    {s.overallCoverage ?? '—'}
                  </td>
                  <td style={cellStyle}>
                    <Text size="xs" color="secondary">
                      {s.justification ?? ''}
                    </Text>
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>
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
        recordId={`pa:${articleKey}`}
        initialComments={initialComments}
        viewerEmail={viewerEmail}
      />
    </>
  );
}
