import { describe, expect, it } from 'vitest';
import type { CodeRecord } from '@/lib/pb/types';
import { computeCoverageStats } from './coverage-stats-compute';

function makeCode(partial: Partial<CodeRecord>): CodeRecord {
  return {
    id: Math.random().toString(36).slice(2),
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'codes',
    specialtySlug: 'spec',
    code: Math.random().toString(36).slice(2),
    mappedAt: 1,
    ...partial,
  } as CodeRecord;
}

/**
 * Build a population matching the user's spreadsheet score distribution
 * (score → count): 0:184, 1:130, 2:249, 3:543, 4:312, 5:3 (total 1421, all
 * mapped). Verifies the count column, cumulative columns, avg coverage (2.48),
 * and the ≥3 / <3 percentages (60.38% / 39.62%).
 */
function buildSpreadsheetPopulation(): CodeRecord[] {
  const dist: Record<number, number> = {
    0: 184,
    1: 130,
    2: 249,
    3: 543,
    4: 312,
    5: 3,
  };
  const codes: CodeRecord[] = [];
  for (const [score, count] of Object.entries(dist)) {
    for (let i = 0; i < count; i++) {
      codes.push(makeCode({ depthOfCoverage: Number(score), mappedAt: 1 }));
    }
  }
  return codes;
}

describe('computeCoverageStats', () => {
  it('reproduces the spreadsheet coverage-score distribution', () => {
    const stats = computeCoverageStats(buildSpreadsheetPopulation());

    expect(stats.total).toBe(1421);
    expect(stats.mappedCount).toBe(1421);
    expect(stats.unmappedCount).toBe(0);

    expect(stats.scoreRows.map((r) => r.count)).toEqual([184, 130, 249, 543, 312, 3]);
    // Cumulative count is monotonic and ends at the mapped total.
    expect(stats.scoreRows.map((r) => r.cumCount)).toEqual([
      184, 314, 563, 1106, 1418, 1421,
    ]);
    // Reverse cumulative starts at the mapped total and ends at the top bucket.
    expect(stats.scoreRows.map((r) => r.revCumCount)).toEqual([
      1421, 1237, 1107, 858, 315, 3,
    ]);

    expect(stats.avgCoverage).toBeCloseTo(2.48, 2);
    expect(stats.pctCoverageGte3).toBeCloseTo(60.38, 1);
    expect(stats.pctCoverageLt3).toBeCloseTo(39.62, 1);
    // Cumulative/reverse-cumulative percentages bookend at 100%.
    expect(stats.scoreRows[5].cumPct).toBe(100);
    expect(stats.scoreRows[0].revCumPct).toBe(100);
  });

  it('keeps unmapped codes as a separate bucket (not score 0)', () => {
    const codes = [
      makeCode({ mappedAt: 0, depthOfCoverage: 0 }),
      makeCode({ mappedAt: 0 }),
      makeCode({ mappedAt: 5, depthOfCoverage: 0 }),
      makeCode({ mappedAt: 5, depthOfCoverage: 4 }),
    ];
    const stats = computeCoverageStats(codes);

    expect(stats.total).toBe(4);
    expect(stats.mappedCount).toBe(2);
    expect(stats.unmappedCount).toBe(2);
    // Only the mapped score-0 code lands in the score-0 bucket.
    expect(stats.scoreRows[0].count).toBe(1);
    expect(stats.scoreRows[4].count).toBe(1);
  });

  it('computes In-AMBOSS counts and percentages over total codes', () => {
    const codes = [
      makeCode({ isInAMBOSS: true }),
      makeCode({ isInAMBOSS: true }),
      makeCode({ isInAMBOSS: false }),
      makeCode({ isInAMBOSS: undefined }),
    ];
    const stats = computeCoverageStats(codes);

    expect(stats.inAmboss).toBe(2);
    expect(stats.notInAmboss).toBe(2); // total - inAmboss
    expect(stats.pctInAmboss).toBe(50);
    expect(stats.pctNotInAmboss).toBe(50);
  });

  it('aggregates article/section coverage with total and unique counts', () => {
    const codes = [
      makeCode({
        articlesWhereCoverageIs: [
          { articleId: 'a1', sections: [{ sectionId: 's1' }, { sectionId: 's2' }] },
          { articleId: 'a2', sections: [{ sectionId: 's3' }] },
        ],
      }),
      makeCode({
        // a1 repeats (unique stays 2 across articles); s1 repeats too.
        articlesWhereCoverageIs: [{ articleId: 'a1', sections: [{ sectionId: 's1' }] }],
      }),
    ];
    const stats = computeCoverageStats(codes);

    expect(stats.totalArticlesCovered).toBe(3);
    expect(stats.uniqueArticlesCovered).toBe(2); // a1, a2
    expect(stats.totalSectionsCovered).toBe(4);
    expect(stats.uniqueSectionsCovered).toBe(3); // s1, s2, s3
    expect(stats.avgArticlesCovered).toBe(1.5); // 3 / 2 codes
  });

  it('counts consolidated suggestions from the post-consolidation output', () => {
    // Stats are counted over the consolidatedArticles / consolidatedSections
    // rows (what exists AFTER consolidation), not the per-code arrays.
    const codes = [
      makeCode({ consolidationCategory: 'C1' }),
      makeCode({ consolidationCategory: 'C2' }),
    ];
    const stats = computeCoverageStats(codes, {
      consolidatedArticles: [
        { overallCoverage: 1 }, // < 3
        { overallCoverage: 4 }, // ≥ 3
        { overallCoverage: undefined }, // unknown coverage → not counted in <3
      ],
      consolidatedSections: [
        { exists: true, overallCoverage: 2, articleId: 'a1' }, // update, < 3
        { exists: true, overallCoverage: 5, articleId: 'a1' }, // update, ≥ 3 (same article)
        { exists: false, overallCoverage: 1, articleId: 'a2' }, // new section, < 3
        { exists: true, overallCoverage: 4, articleId: 'a3' }, // update, ≥ 3
      ],
    });

    expect(stats.numConsolidations).toBe(2);
    expect(stats.newArticles).toBe(3);
    expect(stats.newArticlesLt3).toBe(1); // only overallCoverage 1
    expect(stats.avgArticlesPerConsolidation).toBe(1.5); // 3 / 2 consolidations

    expect(stats.totalSectionChanges).toBe(4);
    expect(stats.newSections).toBe(1); // the exists:false row
    expect(stats.sectionUpdates).toBe(3); // the three exists:true rows
    expect(stats.articleUpdates).toBe(3); // distinct articles a1, a2, a3
    expect(stats.totalSectionChangesLt3).toBe(2); // coverage 2 and 1
    expect(stats.newSectionsLt3).toBe(1);
    expect(stats.sectionUpdatesLt3).toBe(1); // only the coverage-2 update
    expect(stats.articleUpdatesLt3).toBe(2); // a1 (has a <3 section) and a2
  });

  it('reports consolidation run progress from the passed-in counts', () => {
    const codes = [
      makeCode({ consolidationCategory: 'A' }),
      makeCode({ consolidationCategory: 'B' }),
      makeCode({ consolidationCategory: 'C' }),
    ];
    const stats = computeCoverageStats(codes, {
      consolidationsExpected: 3,
      consolidationsRun: 2,
    });
    expect(stats.consolidationsExpected).toBe(3);
    expect(stats.consolidationsRun).toBe(2);

    // Without explicit progress, expected falls back to distinct categories.
    const fallback = computeCoverageStats(codes);
    expect(fallback.consolidationsExpected).toBe(3);
    expect(fallback.consolidationsRun).toBe(0);
  });

  it('handles JSON-string array fields and an empty population', () => {
    const stringy = makeCode({
      // PocketBase can hand back JSON strings instead of parsed arrays.
      articlesWhereCoverageIs: JSON.stringify([
        { articleId: 'a1', sections: [{ sectionId: 's1' }, { sectionId: 's2' }] },
      ]) as never,
    });
    const stats = computeCoverageStats([stringy]);
    expect(stats.totalArticlesCovered).toBe(1);
    expect(stats.uniqueArticlesCovered).toBe(1);
    expect(stats.uniqueSectionsCovered).toBe(2);

    const empty = computeCoverageStats([]);
    expect(empty.total).toBe(0);
    expect(empty.avgCoverage).toBe(0);
    expect(empty.avgArticlesPerConsolidation).toBe(0); // no divide-by-zero
    expect(empty.pctInAmboss).toBe(0);
    expect(empty.consolidationsExpected).toBe(0);
    expect(empty.consolidationsRun).toBe(0);
  });
});
