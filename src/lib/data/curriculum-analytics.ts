/**
 * Pure reducers over a curriculum plan's codes, powering the post-mapping
 * analytics dashboard (Timeline / Gap Report / Review Notes).
 *
 * Side-effect-free and PB-free — every input is the already-fetched
 * `CodeRecord[]` (from `listCodes`), so these run client-side without a query
 * and stay unit-testable, mirroring `coverage-stats-compute.ts` and
 * `curriculum-plans.ts`.
 */

import type { CodeRecord } from '@/lib/pb/types';
import type { CurriculumMeta } from '@/lib/types';
import { topBlockOf, UNCATEGORIZED } from './curriculum-category';

// --- Coverage helpers (shared by Gap report + Timeline tinting) ------------

/** Coverage score clamped to 0–5. Prefers the synthesized overall score, with a
 *  `?? depthOfCoverage` fallback for rows mapped before the overall track — the
 *  same precedence as `coverage-stats-compute.ts`. Unmapped/unset → 0. */
export function depthOf(c: CodeRecord): number {
  const raw =
    typeof c.overallDepthOfCoverage === 'number'
      ? c.overallDepthOfCoverage
      : typeof c.depthOfCoverage === 'number'
        ? c.depthOfCoverage
        : 0;
  return Math.min(5, Math.max(0, Math.round(raw)));
}

/** The coverage-level label to show — overall when present, else the AMBOSS
 *  level, else `'none'` (curriculum scale: none→year-1…→residency-ready). */
export function coverageLevelOf(c: CodeRecord): string {
  return c.overallCoverageLevel || c.coverageLevel || 'none';
}

/** A code is mapped once the mapping workflow has stamped `mappedAt`. */
export function isMapped(c: CodeRecord): boolean {
  return (c.mappedAt ?? 0) > 0;
}

// --- Timeline ---------------------------------------------------------------

/** Calendar month the academic year starts in (September = 9). The Timeline
 *  renders 12 columns from here, so a Sep-starting block sits in column 0. */
export const ACADEMIC_YEAR_START_MONTH = 9;

/** ≈ weeks per calendar month, for turning `durationWeeks` into column span. */
const WEEKS_PER_MONTH = 4.345;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The 12 academic-year column labels, starting at {@link ACADEMIC_YEAR_START_MONTH}. */
export const MONTH_LABELS: string[] = Array.from(
  { length: 12 },
  (_, i) => MONTH_NAMES[(ACADEMIC_YEAR_START_MONTH - 1 + i) % 12],
);

/**
 * Parse a free-form month string to a calendar month index 1–12, or null.
 * Accepts `YYYY-MM` / `YYYY/MM`, a bare numeric month, or a month name (matched
 * on its first three letters, case-insensitive). Anything else → null.
 */
export function parseMonth(raw?: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const iso = s.match(/^\d{4}[-/](\d{1,2})$/);
  if (iso) {
    const m = Number(iso[1]);
    return m >= 1 && m <= 12 ? m : null;
  }
  if (/^\d{1,2}$/.test(s)) {
    const m = Number(s);
    return m >= 1 && m <= 12 ? m : null;
  }
  const idx = MONTH_NAMES.findIndex((n) => n.toLowerCase() === s.slice(0, 3));
  return idx === -1 ? null : idx + 1;
}

/** Map a calendar month (1–12) to its 0-based academic-year column. */
export function acadMonthIndex(calMonth: number): number {
  return (calMonth - ACADEMIC_YEAR_START_MONTH + 12) % 12;
}

export interface TimelineBar {
  code: CodeRecord;
  /** 0-based start column on the academic-year axis. */
  startCol: number;
  /** 0-based end column, inclusive. */
  endCol: number;
  /** Sub-lane within its row group (greedy interval packing, 0-based). */
  lane: number;
  /** Top-level block, for context / tinting. */
  block: string;
}

export interface TimelineRow {
  /** Stable group key, e.g. `year-1` / `phase:clerkship` / `unspecified`. */
  key: string;
  /** Display label, e.g. `Year 1`. */
  label: string;
  /** Number of sub-lanes used (max lane + 1). */
  laneCount: number;
  bars: TimelineBar[];
}

export interface UnscheduledGroup {
  block: string;
  codes: CodeRecord[];
}

export interface Timeline {
  /** Month column labels (length 12). */
  months: string[];
  /** Scheduled rows (by year/phase), sorted years→phases→unspecified. */
  rows: TimelineRow[];
  /** Topics with no parseable calendar position, grouped by block. */
  unscheduled: UnscheduledGroup[];
  /** Total scheduled bars across all rows (0 → render the fallback only). */
  scheduledCount: number;
}

type RowSort = [number, number, string];

function rowGrouping(meta: CurriculumMeta | undefined): {
  key: string;
  label: string;
  sort: RowSort;
} {
  if (meta?.year != null) {
    return {
      key: `year-${meta.year}`,
      label: `Year ${meta.year}`,
      sort: [0, meta.year, ''],
    };
  }
  const phase = meta?.phase?.trim();
  if (phase) {
    return {
      key: `phase:${phase.toLowerCase()}`,
      label: phase,
      sort: [1, 0, phase.toLowerCase()],
    };
  }
  return { key: 'unspecified', label: 'Unspecified', sort: [2, 0, ''] };
}

/**
 * Lay a plan's codes onto an academic-year gantt. A code is schedulable when its
 * `startMonth` parses; otherwise it drops into the by-block `unscheduled` list.
 * Bar span comes from `endMonth`, else `durationWeeks` (≈ months), else a single
 * cell — clamped to the 12-column year (no wrap). Within each year/phase row,
 * overlapping bars are packed onto sub-lanes so they never visually collide.
 */
export function buildTimeline(codes: CodeRecord[]): Timeline {
  type Pending = {
    bar: Omit<TimelineBar, 'lane'>;
    key: string;
    label: string;
    sort: RowSort;
  };
  const pending: Pending[] = [];
  const unscheduledMap = new Map<string, CodeRecord[]>();

  for (const code of codes) {
    const meta = code.curriculumMeta;
    const startCal = parseMonth(meta?.startMonth);
    if (startCal === null) {
      const block = topBlockOf(code.category);
      const arr = unscheduledMap.get(block);
      if (arr) arr.push(code);
      else unscheduledMap.set(block, [code]);
      continue;
    }
    const startCol = acadMonthIndex(startCal);
    let endCol = startCol;
    const endCal = parseMonth(meta?.endMonth);
    if (endCal !== null) {
      const e = acadMonthIndex(endCal);
      // Don't wrap a single bar past the year boundary — clamp instead.
      endCol = e >= startCol ? e : 11;
    } else if (meta?.durationWeeks && meta.durationWeeks > 0) {
      const span = Math.max(0, Math.round(meta.durationWeeks / WEEKS_PER_MONTH) - 1);
      endCol = Math.min(11, startCol + span);
    }
    const g = rowGrouping(meta);
    pending.push({
      bar: { code, startCol, endCol, block: topBlockOf(code.category) },
      key: g.key,
      label: g.label,
      sort: g.sort,
    });
  }

  const groups = new Map<
    string,
    { label: string; sort: RowSort; items: Omit<TimelineBar, 'lane'>[] }
  >();
  for (const p of pending) {
    const g = groups.get(p.key);
    if (g) g.items.push(p.bar);
    else groups.set(p.key, { label: p.label, sort: p.sort, items: [p.bar] });
  }

  const rows = Array.from(groups.entries())
    .map(([key, g]) => {
      const sorted = [...g.items].sort(
        (a, b) => a.startCol - b.startCol || a.endCol - b.endCol,
      );
      const laneEnds: number[] = []; // last endCol placed in each lane
      const bars: TimelineBar[] = [];
      for (const item of sorted) {
        let lane = laneEnds.findIndex((end) => end < item.startCol);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(item.endCol);
        } else {
          laneEnds[lane] = item.endCol;
        }
        bars.push({ ...item, lane });
      }
      return {
        row: { key, label: g.label, laneCount: laneEnds.length, bars },
        sort: g.sort,
      };
    })
    .sort(
      (a, b) =>
        a.sort[0] - b.sort[0] ||
        a.sort[1] - b.sort[1] ||
        a.sort[2].localeCompare(b.sort[2]),
    )
    .map((r) => r.row);

  const unscheduled = Array.from(unscheduledMap.entries())
    .map(([block, blockCodes]) => ({ block, codes: blockCodes }))
    .sort((a, b) => {
      if (a.block === UNCATEGORIZED) return 1;
      if (b.block === UNCATEGORIZED) return -1;
      return a.block.localeCompare(b.block);
    });

  const scheduledCount = rows.reduce((n, r) => n + r.bars.length, 0);
  return { months: MONTH_LABELS, rows, unscheduled, scheduledCount };
}

// --- Gap report -------------------------------------------------------------

export interface GapCriteria {
  /** Exclude items a human rejected (out of mapping scope). */
  requireInScope: boolean;
  /** Count never-mapped items (`mappedAt` falsy). */
  unmapped: boolean;
  /** Count mapped items explicitly not found in AMBOSS (`isInAMBOSS===false`).
   *  A mapped item with no coverage level scores depth 0, so it is already
   *  caught by `shallow`; this targets the explicit not-found flag. */
  notInAmboss: boolean;
  /** Count mapped items at or below `shallowMax` depth. */
  shallow: boolean;
  /** Depth (0–5) at/under which a mapped item counts as a shallow gap. */
  shallowMax: number;
}

export const DEFAULT_GAP_CRITERIA: GapCriteria = {
  requireInScope: true,
  unmapped: true,
  notInAmboss: true,
  shallow: true,
  shallowMax: 1,
};

/** Whether a single code is a coverage gap under the given criteria. In-scope =
 *  not human-rejected (approved + pending both count). */
export function isGap(
  code: CodeRecord,
  criteria: GapCriteria = DEFAULT_GAP_CRITERIA,
): boolean {
  if (criteria.requireInScope && (code.curriculumReviewStatus ?? '') === 'rejected') {
    return false;
  }
  if (!isMapped(code)) return criteria.unmapped;
  if (criteria.notInAmboss && code.isInAMBOSS === false) return true;
  if (criteria.shallow && depthOf(code) <= criteria.shallowMax) return true;
  return false;
}

/** All in-scope coverage gaps, most-severe first (unmapped, then by depth asc). */
export function computeGapRows(
  codes: CodeRecord[],
  criteria: GapCriteria = DEFAULT_GAP_CRITERIA,
): CodeRecord[] {
  return codes
    .filter((c) => isGap(c, criteria))
    .sort((a, b) => {
      const am = isMapped(a) ? 1 : 0;
      const bm = isMapped(b) ? 1 : 0;
      if (am !== bm) return am - bm; // unmapped first
      return depthOf(a) - depthOf(b); // then shallowest first
    });
}

// --- Review notes -----------------------------------------------------------

export type ReviewStatus = '' | 'approved' | 'rejected';

export interface ReviewRow {
  id: string;
  code: string;
  description: string;
  block: string;
  status: ReviewStatus;
  /** Reviewer email, or '' when never reviewed. */
  reviewer: string;
  /** ms since epoch, or null when never reviewed. */
  reviewedAt: number | null;
  notes: string;
  gaps: string;
  improvements: string;
}

/** Project codes into read-only review rows (status + reviewer + free-text). */
export function buildReviewRows(codes: CodeRecord[]): ReviewRow[] {
  return codes.map((c) => ({
    id: c.id ?? c.code,
    code: c.code,
    description: c.description?.trim() || '—',
    block: topBlockOf(c.category),
    status: (c.curriculumReviewStatus ?? '') as ReviewStatus,
    reviewer: c.curriculumReviewedBy?.trim() || '',
    reviewedAt:
      c.curriculumReviewedAt && c.curriculumReviewedAt > 0
        ? c.curriculumReviewedAt
        : null,
    notes: c.notes?.trim() || '',
    gaps: c.gaps?.trim() || '',
    improvements: c.improvements?.trim() || '',
  }));
}

export interface ReviewCounts {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
}

/** Tally review rows by status (status `''` = pending). */
export function reviewCounts(rows: ReviewRow[]): ReviewCounts {
  const counts: ReviewCounts = { all: rows.length, pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) {
    if (r.status === 'approved') counts.approved += 1;
    else if (r.status === 'rejected') counts.rejected += 1;
    else counts.pending += 1;
  }
  return counts;
}
