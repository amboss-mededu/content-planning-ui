/**
 * Status-aware visibility gates for the three article-generation
 * pipeline triggers (literature search, Cortex source registration,
 * LLM draft). Shared between the backlog tables and the Article
 * Manager modal so the "is this stage actionable for this article
 * right now?" logic lives in one place.
 *
 * Semantics are "is the button worth showing as an actionable affordance".
 * The backlog row-action columns historically render the Cortex and
 * Draft buttons unconditionally side-by-side and let their internal
 * state communicate progress; that table-only convention is preserved.
 * The modal uses these gates to hide the non-actionable stages so the
 * eligible one reads as the next step.
 */

import type { ArticleBacklogStatus } from '@/lib/pb/types';

/** Lit search applies to articles that haven't picked up any sources
 *  yet. Missing rows, `unassigned`, and `waiting-for-sources` all
 *  mean the same thing for this purpose. */
export function canRunLitSearch(
  status: ArticleBacklogStatus | undefined,
  sourcesCount: number,
): boolean {
  if (sourcesCount > 0) return false;
  return (
    status === undefined || status === 'unassigned' || status === 'waiting-for-sources'
  );
}

/** Cortex registration only makes sense once the sources have been
 *  picked AND the editor has approved them, AND there's still
 *  something to register. */
export function canRegisterCortex(
  status: ArticleBacklogStatus | undefined,
  sourcesCount: number,
  registeredSourcesCount: number,
): boolean {
  if (sourcesCount === 0) return false;
  if (registeredSourcesCount >= sourcesCount) return false;
  return status === 'sources-approved';
}

/** Drafting is actionable from `ready-for-llm-draft` onwards — the
 *  button itself handles re-drafting after a completed/failed run via
 *  its internal `initialRun` state, so later statuses still see it. */
export function canDraft(status: ArticleBacklogStatus | undefined): boolean {
  if (!status) return false;
  return (
    status === 'ready-for-llm-draft' ||
    status === 'ready-for-editing' ||
    status === 'editing-in-progress' ||
    status === 'ready-to-publish' ||
    status === 'published'
  );
}
