import { describe, expect, it } from 'vitest';
import { deriveCodeTableCounts } from './code-table-counts';

describe('deriveCodeTableCounts', () => {
  it('prefers counts derived from mapping arrays over stale stored counts', () => {
    expect(
      deriveCodeTableCounts({
        articlesWhereCoverageIs: [
          { articleTitle: 'A', sections: [{ sectionTitle: 'A1' }] },
          {
            articleTitle: 'B',
            sections: [{ sectionTitle: 'B1' }, { sectionTitle: 'B2' }],
          },
        ],
        existingArticleUpdates: [{ articleTitle: 'A', sections: [] }],
        newArticlesNeeded: [{ articleTitle: 'C' }],
        coverageArticleCount: 1511,
        coverageSectionCount: 1511,
        existingArticleUpdateCount: 867,
        newArticleSuggestionCount: 165,
      }),
    ).toEqual({
      coverageArticleCount: 2,
      coverageSectionCount: 3,
      existingArticleUpdateCount: 1,
      newArticleSuggestionCount: 1,
      guidelineCount: 0,
      guidelineRecommendationCount: 0,
    });
  });

  it('handles legacy serialized JSON array values', () => {
    expect(
      deriveCodeTableCounts({
        articlesWhereCoverageIs: JSON.stringify([
          {
            articleTitle: 'A',
            sections: { First: 'section-1', Second: 'section-2' },
          },
        ]),
        existingArticleUpdates: JSON.stringify([
          { articleTitle: 'A' },
          { articleTitle: 'B' },
        ]),
        newArticlesNeeded: JSON.stringify([]),
      }),
    ).toEqual({
      coverageArticleCount: 1,
      coverageSectionCount: 2,
      existingArticleUpdateCount: 2,
      newArticleSuggestionCount: 0,
      guidelineCount: 0,
      guidelineRecommendationCount: 0,
    });
  });

  it('falls back to stored counts when source arrays are unavailable', () => {
    expect(
      deriveCodeTableCounts({
        coverageArticleCount: 4,
        coverageSectionCount: 7,
        existingArticleUpdateCount: 2,
        newArticleSuggestionCount: 1,
      }),
    ).toEqual({
      coverageArticleCount: 4,
      coverageSectionCount: 7,
      existingArticleUpdateCount: 2,
      newArticleSuggestionCount: 1,
      guidelineCount: 0,
      guidelineRecommendationCount: 0,
    });
  });

  it('counts guidelines and their recommendations', () => {
    const counts = deriveCodeTableCounts({
      guidelinesWhereCoverageIs: [
        {
          guidelineTitle: 'G1',
          recommendations: [{ recommendationTitle: 'R1' }, { recommendationTitle: 'R2' }],
        },
        { guidelineTitle: 'G2', recommendations: [{ recommendationTitle: 'R3' }] },
      ],
    });
    expect(counts.guidelineCount).toBe(2);
    expect(counts.guidelineRecommendationCount).toBe(3);
  });

  it('falls back to stored guideline counts when the array is unavailable', () => {
    const counts = deriveCodeTableCounts({
      guidelineCount: 5,
      guidelineRecommendationCount: 9,
    });
    expect(counts.guidelineCount).toBe(5);
    expect(counts.guidelineRecommendationCount).toBe(9);
  });
});
