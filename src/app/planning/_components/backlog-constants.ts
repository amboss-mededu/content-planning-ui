/**
 * Shared constants for the backlog table + article manager modal. Lives
 * outside both so the modal can render the same status labels/colors as
 * the inline cell without circular imports.
 */

import type { ArticleBacklogStatus } from '@/lib/pb/types';

export type BadgeColor = 'gray' | 'yellow' | 'blue' | 'purple' | 'brand' | 'green';

// Unassigned dropped from the UI per editor request — the default state for
// a freshly-approved article is "Waiting for sources". Any legacy row still
// tagged `unassigned` in PB renders with the same color/label as
// `waiting-for-sources` so it doesn't read as broken.
export const STATUS_COLOR: Record<ArticleBacklogStatus, BadgeColor> = {
  unassigned: 'yellow',
  'waiting-for-sources': 'yellow',
  'sources-searched': 'yellow',
  'sources-approved': 'blue',
  'ready-for-llm-draft': 'blue',
  'ready-for-editing': 'purple',
  'editing-in-progress': 'purple',
  'ready-to-publish': 'brand',
  published: 'green',
};

// Filter dropdown labels match the 7-phase chip stepper so editors see a
// single vocabulary across the modal, the backlog table, and the filter.
// `editing-in-progress` collapses into `ready-for-editing` (both phase 5,
// both "Review article") to avoid a duplicate filter entry — editors can
// still transition through `editing-in-progress` via the row's inline
// status dropdown.
export const STATUS_OPTIONS: Array<{ value: ArticleBacklogStatus; label: string }> = [
  { value: 'waiting-for-sources', label: 'Search sources' },
  { value: 'sources-searched', label: 'Approve sources' },
  { value: 'sources-approved', label: 'Prioritize sources' },
  { value: 'ready-for-llm-draft', label: 'Draft article' },
  { value: 'ready-for-editing', label: 'Review article' },
  { value: 'ready-to-publish', label: 'Article ready' },
  { value: 'published', label: 'Published' },
];

// Mirrors `PHASE_LABEL[phaseFromStatus(status)]` — every badge in the app
// reads through this map, so aligning the values here means the modal
// header, the backlog table row, the my-backlog row, and the "Currently:"
// subheader all speak the same chip-stepper vocabulary.
export const STATUS_LABEL: Record<ArticleBacklogStatus, string> = {
  unassigned: 'Search sources',
  'waiting-for-sources': 'Search sources',
  'sources-searched': 'Approve sources',
  'sources-approved': 'Prioritize sources',
  'ready-for-llm-draft': 'Draft article',
  'ready-for-editing': 'Review article',
  'editing-in-progress': 'Review article',
  'ready-to-publish': 'Article ready',
  published: 'Published',
};

// Translation from current status → human-readable next step. Surfaced
// in the "Next action" column so editors can see what to do without
// looking up the workflow.
export const NEXT_ACTION: Record<ArticleBacklogStatus, string> = {
  unassigned: 'Literature search',
  'waiting-for-sources': 'Literature search',
  'sources-searched': 'Review sources',
  'sources-approved': 'Upload to Cortex',
  'ready-for-llm-draft': 'Generate draft',
  'ready-for-editing': 'Edit draft',
  'editing-in-progress': 'Finish edits',
  'ready-to-publish': 'Publish',
  published: '—',
};

// Buckets for the leadingNote counts. "Waiting for sources" splits out
// because it's the start-of-pipeline state; "In progress" covers
// everything between sources-searched and ready-to-publish.
export const WAITING_STATUSES: ArticleBacklogStatus[] = [
  'unassigned',
  'waiting-for-sources',
];
export const IN_PROGRESS_STATUSES: ArticleBacklogStatus[] = [
  'sources-searched',
  'sources-approved',
  'ready-for-llm-draft',
  'ready-for-editing',
  'editing-in-progress',
  'ready-to-publish',
];

/**
 * Treat the `unassigned` PB value as `waiting-for-sources` for the
 * stepper-index lookup so a legacy row maps cleanly to the first step.
 */
export function statusToStepValue(s: ArticleBacklogStatus): ArticleBacklogStatus {
  return s === 'unassigned' ? 'waiting-for-sources' : s;
}

/**
 * The Article Manager modal collapses the 9 backlog statuses into a 7-phase
 * linear pipeline. Each phase has its own content panel + advance affordance.
 * Phase 5 covers both `ready-for-editing` and `editing-in-progress`.
 */
export type ArticleManagerPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const PHASE_LABEL: Record<ArticleManagerPhase, string> = {
  1: 'Search sources',
  2: 'Approve sources',
  3: 'Prioritize sources',
  4: 'Draft article',
  5: 'Review article',
  6: 'Article ready',
  7: 'Published',
};

/** Canonical status the stepper picks when the editor revisits an earlier
 *  phase. Picking phase 5 lands on `ready-for-editing` (the entry point);
 *  if the editor was already at `editing-in-progress` they can flip it
 *  explicitly via other tooling. */
export const PHASE_TO_STATUS: Record<ArticleManagerPhase, ArticleBacklogStatus> = {
  1: 'waiting-for-sources',
  2: 'sources-searched',
  3: 'sources-approved',
  4: 'ready-for-llm-draft',
  5: 'ready-for-editing',
  6: 'ready-to-publish',
  7: 'published',
};
