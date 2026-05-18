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

import type { ArticleBacklogStatus, ArticleSourceRecord } from '@/lib/pb/types';
import type { ArticleManagerPhase } from './backlog-constants';

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

/** Maps the 9-status enum into the 7-phase pipeline used by the Article
 *  Manager modal. `unassigned` collapses to phase 1, and the two
 *  editing statuses collapse to phase 5. */
export function phaseFromStatus(
  status: ArticleBacklogStatus | undefined,
): ArticleManagerPhase {
  switch (status) {
    case 'sources-searched':
      return 2;
    case 'sources-approved':
      return 3;
    case 'ready-for-llm-draft':
      return 4;
    case 'ready-for-editing':
    case 'editing-in-progress':
      return 5;
    case 'ready-to-publish':
      return 6;
    case 'published':
      return 7;
    default:
      return 1;
  }
}

/** Phase 2 → 3 advance is enabled once the editor has approved at least
 *  one source. Rejection-only doesn't count — drafting needs material. */
export function canApproveSources(sources: ArticleSourceRecord[]): boolean {
  return sources.some((s) => s.reviewStatus === 'approved');
}

/** Phase 3 → 4 advance is hard-gated: every approved source must carry a
 *  non-empty `cortexSourceId`, since the writer ingests only that subset. */
export function canStartDraft(sources: ArticleSourceRecord[]): boolean {
  const approved = sources.filter((s) => s.reviewStatus === 'approved');
  if (approved.length === 0) return false;
  return approved.every(
    (s) => typeof s.cortexSourceId === 'string' && s.cortexSourceId.length > 0,
  );
}

/** Used in the tooltip when the draft button is disabled — tells the
 *  editor how many Source IDs are still missing. */
export function missingCortexIdCount(sources: ArticleSourceRecord[]): number {
  return sources.filter(
    (s) =>
      s.reviewStatus === 'approved' &&
      (!s.cortexSourceId || s.cortexSourceId.length === 0),
  ).length;
}
