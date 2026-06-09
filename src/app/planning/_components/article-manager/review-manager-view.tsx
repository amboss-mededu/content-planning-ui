'use client';

// New-article review surface (type='new', stage='review-*'). Extracted
// verbatim from article-manager-modal-v2.tsx.

import { Badge, Button, Inline, Modal, Stack, Text } from '@amboss/design-system';
import { useEffect, useMemo, useState } from 'react';
import { log } from '@/lib/log';
import type { ArticleRow } from '../articles-view';
import { CodeChipList } from '../code-chip';
import { CommentsSection } from '../comments-section';
import { DecisionNoteField, footerStyle, reviewerLabel, SharedHeader } from './shared';
import type { ReviewerMap, ReviewMap, ReviewOpener, ReviewStatus } from './types';

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

export function ReviewManagerView({
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
      log('article-manager').error(
        'decide: row has no articleKey — cannot persist review',
      );
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
      log('article-manager').error('decideArticle failed', err);
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
      log('article-manager').error('decideArticle (reset) failed', err);
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
