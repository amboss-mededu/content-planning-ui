import { describe, expect, it } from 'vitest';
import { resetCodeCategoryDecisionArrays } from './reset-scope-helpers';

describe('resetCodeCategoryDecisionArrays', () => {
  it('removes target bucket codes from every source decision array', () => {
    const patch = resetCodeCategoryDecisionArrays(
      {
        includedArticleCodes: ['A', 'B'],
        excludedArticleCodes: ['C', 'D'],
        includedSectionCodes: ['E', 'A'],
        excludedSectionCodes: ['F'],
        totallyIgnoredCodes: ['G', 'B'],
      },
      new Set(['A', 'B', 'F']),
    );

    expect(patch).toMatchObject({
      includedArticleCodes: [],
      numIncludedArticleCodes: 0,
      excludedArticleCodes: ['C', 'D'],
      numExcludedArticleCodes: 2,
      includedSectionCodes: ['E'],
      numIncludedSectionCodes: 1,
      excludedSectionCodes: [],
      numExcludedSectionCodes: 0,
      totallyIgnoredCodes: ['G'],
      numTotallyIgnoredCodes: 1,
      numIncludedCodes: 1,
      isConsolidated: false,
    });
  });
});
