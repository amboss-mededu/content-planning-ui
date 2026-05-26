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
    });
  });
});
