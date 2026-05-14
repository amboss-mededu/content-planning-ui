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

export const STATUS_OPTIONS: Array<{ value: ArticleBacklogStatus; label: string }> = [
  { value: 'waiting-for-sources', label: 'Waiting for sources' },
  { value: 'sources-searched', label: 'Sources searched' },
  { value: 'sources-approved', label: 'Sources approved' },
  { value: 'ready-for-llm-draft', label: 'Ready for LLM draft' },
  { value: 'ready-for-editing', label: 'Ready for editing' },
  { value: 'editing-in-progress', label: 'Editing in progress' },
  { value: 'ready-to-publish', label: 'Ready to publish' },
  { value: 'published', label: 'Published' },
];

export const STATUS_LABEL: Record<ArticleBacklogStatus, string> = {
  unassigned: 'Waiting for sources',
  'waiting-for-sources': 'Waiting for sources',
  'sources-searched': 'Sources searched',
  'sources-approved': 'Sources approved',
  'ready-for-llm-draft': 'Ready for LLM draft',
  'ready-for-editing': 'Ready for editing',
  'editing-in-progress': 'Editing in progress',
  'ready-to-publish': 'Ready to publish',
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
