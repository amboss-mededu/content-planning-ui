'use client';

import { Badge, Button, Inline, Modal, Stack, Text } from '@amboss/design-system';
import { useEffect, useMemo, useState } from 'react';
import { resetArticleReview, submitArticleReview } from '../[specialty]/actions';
import type { ArticleRow } from './articles-view';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, TitleOriginLookup } from './code-utils';

export type ReviewStatus = 'approved' | 'rejected';
export type ReviewMap = Record<string, ReviewStatus>;

type SortedRow = ArticleRow & {
  /** Always set — review pass operates only on 1st-pass rows that have an id. */
  id: string;
  category: string;
};

/** Sort consolidated articles into review order: alphabetical by category,
 *  then importance desc within a category. Articles with no category are
 *  pushed to the bottom in an "(uncategorized)" bucket. */
function sortForReview(rows: ArticleRow[]): SortedRow[] {
  const out: SortedRow[] = [];
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

export function ReviewModal({
  slug,
  articles,
  initialReviews,
  categoryLookup,
  titleOriginLookup,
  onClose,
  onReviewsChange,
}: {
  slug: string;
  /** 1st-pass articles to review. */
  articles: ArticleRow[];
  initialReviews: ReviewMap;
  categoryLookup: CategoryLookup;
  titleOriginLookup: TitleOriginLookup;
  onClose: () => void;
  /** Called whenever a review is recorded so the parent can re-tint rows
   *  optimistically without waiting for a server round-trip. */
  onReviewsChange: (next: ReviewMap) => void;
}) {
  const sorted = useMemo(() => sortForReview(articles), [articles]);
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [index, setIndex] = useState(() => {
    // Open at the first unreviewed row if any; otherwise the first row.
    const firstUnreviewed = sorted.findIndex((r) => !initialReviews[r.id]);
    return firstUnreviewed === -1 ? 0 : firstUnreviewed;
  });
  const [submitting, setSubmitting] = useState(false);

  const total = sorted.length;
  const current = sorted[index];

  // Per-bucket progress for the header badge.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers close over latest state via the listed deps; adding decide/goNext/goPrev/onClose would re-bind the listener every render.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
    setSubmitting(true);
    const next: ReviewMap = { ...reviews, [rowId]: status };
    setReviews(next);
    onReviewsChange(next);
    try {
      await submitArticleReview(slug, rowId, status);
    } catch (err) {
      console.error('submitArticleReview failed', err);
      // Revert on failure.
      const reverted = { ...reviews };
      delete reverted[rowId];
      setReviews(reverted);
      onReviewsChange(reverted);
    } finally {
      setSubmitting(false);
      // Auto-advance.
      if (index < total - 1) goNext();
    }
  }

  async function clearDecision() {
    if (!current) return;
    const rowId = current.id;
    setSubmitting(true);
    const next = { ...reviews };
    delete next[rowId];
    setReviews(next);
    onReviewsChange(next);
    try {
      await resetArticleReview(slug, rowId);
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
        <Modal.Text>No 1st-pass articles to review.</Modal.Text>
      </Modal>
    );
  }

  const currentStatus = reviews[current.id];
  const previousTitles = (
    current as ArticleRow & {
      previousArticleTitleSuggestions?: string[];
    }
  ).previousArticleTitleSuggestions;

  return (
    <Modal
      header={`Review · ${index + 1} of ${total}`}
      subHeader={`${current.category} — ${bucketStats?.indexInBucket}/${bucketStats?.bucketSize} in bucket · ${bucketStats?.approved} approved · ${bucketStats?.rejected} rejected · ${bucketStats?.unreviewed} unreviewed`}
      size="l"
      isDismissible
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
          gap: 16,
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
          }}
        >
          <Stack space="s">
            <Inline space="s" vAlignItems="center">
              <Text size="m" weight="bold">
                {current.articleTitle ?? '(untitled)'}
              </Text>
              {currentStatus === 'approved' && <Badge text="approved" color="green" />}
              {currentStatus === 'rejected' && <Badge text="rejected" color="red" />}
            </Inline>
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
          </Stack>

          <Stack space="xs">
            <Text size="s" weight="bold">
              Codes ({current.codes.length})
            </Text>
            <CodeChipList codes={current.codes} categoryLookup={categoryLookup} />
          </Stack>

          {previousTitles && previousTitles.length > 0 && (
            <Stack space="xs">
              <Text size="s" weight="bold">
                Previously consolidated titles
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
        </div>

        <div
          style={{
            flex: 'none',
            borderTop: '1px solid rgba(0, 0, 0, 0.12)',
            paddingTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
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
