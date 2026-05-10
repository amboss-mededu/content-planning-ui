'use client';

import { Badge, Button, Inline, Modal, Stack, Text } from '@amboss/design-system';
import { useEffect, useMemo, useState } from 'react';
import { resetSectionReview, submitSectionReview } from '../[specialty]/actions';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, TitleOriginLookup } from './code-utils';
import type { ReviewMap, ReviewStatus } from './review-modal';
import type { SectionRow } from './sections-view';

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
  initialReviews,
  categoryLookup,
  titleOriginLookup,
  onClose,
  onReviewsChange,
}: {
  slug: string;
  sections: SectionRow[];
  initialReviews: ReviewMap;
  categoryLookup: CategoryLookup;
  titleOriginLookup: TitleOriginLookup;
  onClose: () => void;
  onReviewsChange: (next: ReviewMap) => void;
}) {
  const sorted = useMemo(() => sortForReview(sections), [sections]);
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [index, setIndex] = useState(() => {
    const firstUnreviewed = sorted.findIndex((r) => !initialReviews[r.id]);
    return firstUnreviewed === -1 ? 0 : firstUnreviewed;
  });
  const [submitting, setSubmitting] = useState(false);

  const total = sorted.length;
  const current = sorted[index];

  const bucketStats = useMemo(() => {
    if (!current) return null;
    const inBucket = sorted.filter((r) => r.bucket === current.bucket);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers close over latest state via the listed deps; adding decide/goNext/goPrev/onClose would re-bind every render.
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
      await submitSectionReview(slug, rowId, status);
    } catch (err) {
      console.error('submitSectionReview failed', err);
      const reverted = { ...reviews };
      delete reverted[rowId];
      setReviews(reverted);
      onReviewsChange(reverted);
    } finally {
      setSubmitting(false);
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
      await resetSectionReview(slug, rowId);
    } catch (err) {
      console.error('resetSectionReview failed', err);
    } finally {
      setSubmitting(false);
    }
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

  return (
    <Modal
      header={`Review · ${index + 1} of ${total}`}
      subHeader={`${current.bucket} — ${bucketStats?.indexInBucket}/${bucketStats?.bucketSize} in article · ${bucketStats?.approved} approved · ${bucketStats?.rejected} rejected · ${bucketStats?.unreviewed} unreviewed`}
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
                {current.sectionName ?? '(untitled section)'}
              </Text>
              {current.updateType === 'new' && <Badge text="new" color="blue" />}
              {current.updateType === 'update' && <Badge text="update" color="purple" />}
              {currentStatus === 'approved' && <Badge text="approved" color="green" />}
              {currentStatus === 'rejected' && <Badge text="rejected" color="red" />}
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
                Previously consolidated section names
              </Text>
              {previousNames.map((t) => {
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
