import { describe, expect, it } from 'vitest';
import type { CodeRecord } from '@/lib/pb/types';
import type { CurriculumMeta } from '@/lib/types';
import {
  acadMonthIndex,
  buildReviewRows,
  buildTimeline,
  computeGapRows,
  DEFAULT_GAP_CRITERIA,
  isGap,
  MONTH_LABELS,
  parseMonth,
  reviewCounts,
} from './curriculum-analytics';

let seq = 0;
function mk(
  partial: Partial<CodeRecord> & { curriculumMeta?: CurriculumMeta },
): CodeRecord {
  seq += 1;
  return { code: `c${seq}`, specialtySlug: 'test', ...partial } as CodeRecord;
}

describe('parseMonth', () => {
  it('parses month names by their first three letters', () => {
    expect(parseMonth('Sep')).toBe(9);
    expect(parseMonth('September')).toBe(9);
    expect(parseMonth('jan')).toBe(1);
  });
  it('parses YYYY-MM and YYYY/MM', () => {
    expect(parseMonth('2026-09')).toBe(9);
    expect(parseMonth('2026/03')).toBe(3);
  });
  it('parses bare numeric months', () => {
    expect(parseMonth('9')).toBe(9);
    expect(parseMonth('09')).toBe(9);
  });
  it('rejects out-of-range / junk / empty', () => {
    expect(parseMonth('13')).toBeNull();
    expect(parseMonth('foo')).toBeNull();
    expect(parseMonth('')).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });
});

describe('academic-year axis', () => {
  it('starts at September', () => {
    expect(MONTH_LABELS).toHaveLength(12);
    expect(MONTH_LABELS[0]).toBe('Sep');
    expect(MONTH_LABELS[11]).toBe('Aug');
  });
  it('maps calendar months to academic columns', () => {
    expect(acadMonthIndex(9)).toBe(0); // Sep
    expect(acadMonthIndex(10)).toBe(1); // Oct
    expect(acadMonthIndex(1)).toBe(4); // Jan
    expect(acadMonthIndex(8)).toBe(11); // Aug
  });
});

describe('buildTimeline', () => {
  it('places a dated topic as a bar spanning start→end months', () => {
    const t = buildTimeline([
      mk({ curriculumMeta: { year: 1, startMonth: 'Sep', endMonth: 'Nov' } }),
    ]);
    expect(t.scheduledCount).toBe(1);
    expect(t.rows[0].label).toBe('Year 1');
    expect(t.rows[0].bars[0]).toMatchObject({ startCol: 0, endCol: 2, lane: 0 });
  });

  it('derives span from durationWeeks when no endMonth', () => {
    const t = buildTimeline([
      mk({ curriculumMeta: { startMonth: 'Sep', durationWeeks: 8 } }),
    ]);
    // 8 / 4.345 ≈ 1.84 → round 2 → span 1 → endCol = 0 + 1
    expect(t.rows[0].bars[0]).toMatchObject({ startCol: 0, endCol: 1 });
  });

  it('clamps a bar that would wrap past the year boundary to a single cell', () => {
    const t = buildTimeline([
      mk({ curriculumMeta: { startMonth: 'Aug', endMonth: 'Sep' } }),
    ]);
    expect(t.rows[0].bars[0]).toMatchObject({ startCol: 11, endCol: 11 });
  });

  it('drops topics with no parseable start month into the by-block unscheduled list', () => {
    const t = buildTimeline([
      mk({ category: 'Bloque 3 | 3.1 Algo', curriculumMeta: { year: 2 } }),
      mk({ category: 'Bloque 3 | 3.2 Otra' }),
    ]);
    expect(t.scheduledCount).toBe(0);
    expect(t.unscheduled).toHaveLength(1);
    expect(t.unscheduled[0]).toMatchObject({ block: 'Bloque 3' });
    expect(t.unscheduled[0].codes).toHaveLength(2);
  });

  it('packs overlapping bars in the same row onto separate lanes', () => {
    const t = buildTimeline([
      mk({ curriculumMeta: { year: 1, startMonth: 'Sep', endMonth: 'Nov' } }),
      mk({ curriculumMeta: { year: 1, startMonth: 'Sep', endMonth: 'Nov' } }),
    ]);
    expect(t.rows[0].laneCount).toBe(2);
    expect(t.rows[0].bars.map((b) => b.lane).sort()).toEqual([0, 1]);
  });

  it('sorts rows years → phases → unspecified', () => {
    const t = buildTimeline([
      mk({ curriculumMeta: { startMonth: 'Sep' } }), // unspecified
      mk({ curriculumMeta: { phase: 'Clerkship', startMonth: 'Sep' } }),
      mk({ curriculumMeta: { year: 1, startMonth: 'Sep' } }),
    ]);
    expect(t.rows.map((r) => r.label)).toEqual(['Year 1', 'Clerkship', 'Unspecified']);
  });
});

describe('isGap / computeGapRows', () => {
  it('flags unmapped, not-in-AMBOSS, and shallow as gaps; deep coverage is not', () => {
    expect(isGap(mk({ mappedAt: 0 }))).toBe(true);
    expect(isGap(mk({ mappedAt: 1, isInAMBOSS: false }))).toBe(true);
    expect(isGap(mk({ mappedAt: 1, isInAMBOSS: true, depthOfCoverage: 1 }))).toBe(true);
    expect(isGap(mk({ mappedAt: 1, isInAMBOSS: true, depthOfCoverage: 4 }))).toBe(false);
  });

  it('excludes human-rejected items when requireInScope', () => {
    expect(isGap(mk({ mappedAt: 0, curriculumReviewStatus: 'rejected' }))).toBe(false);
  });

  it('prefers the overall depth over the AMBOSS depth', () => {
    expect(
      isGap(
        mk({
          mappedAt: 1,
          isInAMBOSS: true,
          depthOfCoverage: 1,
          overallDepthOfCoverage: 4,
        }),
      ),
    ).toBe(false);
  });

  it('orders gaps unmapped-first then shallowest-first', () => {
    const rows = computeGapRows(
      [
        mk({
          code: 'deep-but-shallow',
          mappedAt: 1,
          isInAMBOSS: true,
          depthOfCoverage: 1,
        }),
        mk({ code: 'never-mapped', mappedAt: 0 }),
      ],
      DEFAULT_GAP_CRITERIA,
    );
    expect(rows[0].code).toBe('never-mapped');
  });
});

describe('buildReviewRows / reviewCounts', () => {
  it('projects status, reviewer, timestamp and free-text', () => {
    const rows = buildReviewRows([
      mk({
        code: 'x',
        description: 'Topic X',
        category: 'Bloque 1 | 1.1',
        curriculumReviewStatus: 'approved',
        curriculumReviewedBy: 'bsk@medicuja.com',
        curriculumReviewedAt: 1700000000000,
        gaps: 'missing pharmacology',
      }),
    ]);
    expect(rows[0]).toMatchObject({
      description: 'Topic X',
      block: 'Bloque 1',
      status: 'approved',
      reviewer: 'bsk@medicuja.com',
      reviewedAt: 1700000000000,
      gaps: 'missing pharmacology',
    });
  });

  it('treats empty status as pending and tallies counts', () => {
    const rows = buildReviewRows([
      mk({ curriculumReviewStatus: '' }),
      mk({ curriculumReviewStatus: 'approved' }),
      mk({ curriculumReviewStatus: 'rejected' }),
      mk({}),
    ]);
    expect(reviewCounts(rows)).toEqual({ all: 4, pending: 2, approved: 1, rejected: 1 });
  });
});
