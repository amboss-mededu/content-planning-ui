/**
 * Shared constants for the backlog table + article manager modal. Lives
 * outside both so the modal can render the same status labels/colors as
 * the inline cell without circular imports.
 */

import type { ArticleBacklogStatus } from '@/lib/pb/types';

export type BadgeColor = 'gray' | 'yellow' | 'blue' | 'purple' | 'brand' | 'green';

// The badge collapses the 9-value engine into three editor-facing states —
// "Choose sources" (everything before a draft exists), "Drafted" (a draft has
// been generated, through ready-to-publish), and "Published". The underlying
// statuses are preserved (gates/callbacks/cortex-register still read them); only
// the badge color/label and the manual dropdown are bucketed. `unassigned` is a
// legacy value that renders identically to `waiting-for-sources`.
export const STATUS_COLOR: Record<ArticleBacklogStatus, BadgeColor> = {
  unassigned: 'yellow',
  'waiting-for-sources': 'yellow',
  'sources-searched': 'yellow',
  'sources-approved': 'yellow',
  'ready-for-llm-draft': 'yellow',
  'ready-for-editing': 'purple',
  'editing-in-progress': 'purple',
  'ready-to-publish': 'purple',
  published: 'green',
};

// The manual status dropdown (modal badge + both table inline cells + filters)
// offers exactly the three buckets. Each writes the bucket's representative
// value: "Choose sources" → waiting-for-sources (re-enables lit search when a
// row has no sources), "Drafted" → ready-for-editing, "Published" → published.
// The intermediate values (sources-searched, sources-approved,
// ready-for-llm-draft, editing-in-progress, ready-to-publish) are still reached
// automatically by the pipeline callbacks; they just aren't hand-settable.
export const STATUS_OPTIONS: Array<{ value: ArticleBacklogStatus; label: string }> = [
  { value: 'waiting-for-sources', label: 'Choose sources' },
  { value: 'ready-for-editing', label: 'Drafted' },
  { value: 'published', label: 'Published' },
];

// Every badge in the app reads through this map, so the modal header, the
// backlog table row, the my-backlog row, and the "Currently:" subheader all
// speak the same three-state vocabulary.
export const STATUS_LABEL: Record<ArticleBacklogStatus, string> = {
  unassigned: 'Choose sources',
  'waiting-for-sources': 'Choose sources',
  'sources-searched': 'Choose sources',
  'sources-approved': 'Choose sources',
  'ready-for-llm-draft': 'Choose sources',
  'ready-for-editing': 'Drafted',
  'editing-in-progress': 'Drafted',
  'ready-to-publish': 'Drafted',
  published: 'Published',
};

// Three editor-facing buckets the badge/dropdown collapse onto. Used to keep the
// status filters bucket-aware (so "Choose sources" matches every pre-draft
// status, not just the representative value) and to highlight the right option
// in the manual dropdown.
export type StatusBucket = 'choose-sources' | 'drafted' | 'published';

export function statusBucket(s: ArticleBacklogStatus): StatusBucket {
  switch (s) {
    case 'ready-for-editing':
    case 'editing-in-progress':
    case 'ready-to-publish':
      return 'drafted';
    case 'published':
      return 'published';
    default:
      return 'choose-sources';
  }
}

/** The STATUS_OPTIONS value that represents a status's bucket — used as the
 *  `value` of the manual <select> so it highlights the correct collapsed
 *  option even when the row sits at an intermediate (non-settable) status. */
export function statusOptionValue(s: ArticleBacklogStatus): ArticleBacklogStatus {
  switch (statusBucket(s)) {
    case 'drafted':
      return 'ready-for-editing';
    case 'published':
      return 'published';
    default:
      return 'waiting-for-sources';
  }
}

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
