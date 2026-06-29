'use client';

import { Badge } from '@amboss/design-system';

export type BadgeColor =
  | 'green'
  | 'blue'
  | 'yellow'
  | 'brand'
  | 'purple'
  | 'red'
  | 'gray';

// Covers both the clinician scale (none→specialist) and the curriculum-mapping
// year scale (none→residency-ready). The two key sets are disjoint, so one
// lookup serves every mode; unknown strings fall back to gray.
const COVERAGE_COLOR: Record<string, BadgeColor> = {
  none: 'red',
  student: 'yellow',
  'early-resident': 'brand',
  'advanced-resident': 'blue',
  attending: 'green',
  specialist: 'purple',
  // curriculum (year-based) scale
  'year-1': 'yellow',
  'year-2': 'brand',
  'year-3': 'blue',
  'year-4': 'green',
  'residency-ready': 'purple',
};

export function coverageBadgeColor(level: string | undefined): BadgeColor | undefined {
  return level ? COVERAGE_COLOR[level] : undefined;
}

export function CoverageBadge({ level }: { level: string | undefined }) {
  if (!level) return null;
  return <Badge text={level} color={COVERAGE_COLOR[level] ?? 'gray'} />;
}

/**
 * Score chip that piggy-backs on the coverage level for color so the two
 * cells read as one ladder. Renders just the integer — the column header
 * supplies the "Score" label, and the modal renders it next to the coverage
 * badge for context.
 */
export function DepthBadge({
  depth,
  level,
}: {
  depth: number | null | undefined;
  level: string | undefined;
}) {
  if (depth === null || depth === undefined) return null;
  return <Badge text={String(depth)} color={coverageBadgeColor(level) ?? 'gray'} />;
}

export function SuggestionKindBadge({
  kind,
}: {
  kind: 'new-article' | 'new-section' | 'section-update';
}) {
  const colors: Record<typeof kind, BadgeColor> = {
    'new-article': 'green',
    'new-section': 'blue',
    'section-update': 'purple',
  };
  return <Badge text={kind} color={colors[kind]} />;
}
