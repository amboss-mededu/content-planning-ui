'use client';

// Barrel + stage dispatcher for the Article Manager modal family. The 3,200-line
// monolith that used to live here was split into ./article-manager/* (one file
// per surface) with no behavior change; this file preserves the public import
// path so the ~8 consumers keep importing { ArticleManagerModalV2, ReviewMap,
// ReviewerMap } from './article-manager-modal-v2' unchanged.

import { BacklogManagerView } from './article-manager/backlog-manager-view';
import { ReviewManagerView } from './article-manager/review-manager-view';
import type { ManagerOpener } from './article-manager/types';
import { BacklogUpdateView, UpdateReviewView } from './article-manager/update-views';

export { reviewerLabel } from './article-manager/shared';
export type {
  ManagerOpener,
  ReviewerMap,
  ReviewMap,
  ReviewStatus,
} from './article-manager/types';

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
