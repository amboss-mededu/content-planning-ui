import { beforeEach, describe, expect, it, vi } from 'vitest';

// Track every delete()/update() the function issues, per collection, plus
// the per-collection seed data getFullList() returns.
const deletedByCollection: Record<string, string[]> = {};
const updatedByCollection: Record<string, Array<{ id: string; patch: unknown }>> = {};
let seed: Record<string, Array<Record<string, unknown>>> = {};

const pb = {
  filter: (s: string, params?: Record<string, unknown>) =>
    params ? s.replace(/\{:(\w+)\}/g, (_m, k) => String(params[k] ?? '')) : s,
  collection: (name: string) => ({
    getFullList: async (opts?: { filter?: string }) => {
      const rows = seed[name] ?? [];
      // articleSources is read once per articleKey with a scoped filter;
      // honor that so the mock matches real PB scoping (no double-delete).
      if (name === 'articleSources') {
        const key = opts?.filter?.match(/articleKey = (.+)$/)?.[1];
        return key ? rows.filter((r) => r.articleKey === key) : rows;
      }
      return rows;
    },
    update: async (id: string, patch: unknown) => {
      updatedByCollection[name] ??= [];
      updatedByCollection[name].push({ id, patch });
    },
    delete: async (id: string) => {
      deletedByCollection[name] ??= [];
      deletedByCollection[name].push(id);
    },
  }),
};

vi.mock('@/lib/pb/server', () => ({
  createAdminClient: vi.fn(async () => pb),
}));

vi.mock('@/lib/data/article-writing', () => ({
  deleteWritingRunsForArticleAsAdmin: vi.fn(async () => ({ runs: 1, drafts: 1 })),
}));

import { resetConsolidationScope } from './reset-scope';

function setupSeed() {
  seed = {
    codes: [{ code: 'A001', consolidationCategory: 'Airway' }],
    codeCategories: [
      {
        id: 'cat1',
        category: 'Airway',
        includedArticleCodes: ['A001'],
        excludedArticleCodes: [],
        includedSectionCodes: [],
        excludedSectionCodes: [],
        totallyIgnoredCodes: [],
        isConsolidated: true,
      },
    ],
    newArticleSuggestions: [{ id: 'na1', category: 'Airway' }],
    articleUpdateSuggestions: [{ id: 'au1', category: 'Airway' }],
    consolidatedArticles: [{ id: 'ca1', category: 'Airway', articleKey: 'art-key-1' }],
    consolidatedSections: [
      {
        id: 'cs1',
        category: 'Airway',
        sectionKey: 'sec-key-1',
        articleId: 'eid-1',
      },
    ],
    articleReviews: [{ id: 'ar1', articleKey: 'art-key-1', status: 'approved' }],
    sectionReviews: [{ id: 'sr1', sectionKey: 'sec-key-1', status: 'approved' }],
    consolidationCategoryReviews: [{ id: 'ccr1', category: 'Airway' }],
    articleBacklog: [{ id: 'bl1', articleKey: 'art-key-1', articleRecordId: 'rec-1' }],
    reviewComments: [
      { id: 'rc1', recordKind: 'article', recordKey: 'art-key-1' },
      { id: 'rc2', recordKind: 'section', recordKey: 'sec-key-1' },
    ],
    articleSources: [{ id: 'as1', articleKey: 'art-key-1' }],
  };
}

beforeEach(() => {
  for (const key of Object.keys(deletedByCollection)) delete deletedByCollection[key];
  for (const key of Object.keys(updatedByCollection)) delete updatedByCollection[key];
  setupSeed();
});

describe('resetConsolidationScope', () => {
  it('preserve mode (default) deletes only producer rows, keeps downstream', async () => {
    const stats = await resetConsolidationScope({
      specialtySlug: 'anesthesiology',
      consolidationCategories: ['Airway'],
    });

    // Producer rows gone.
    expect(deletedByCollection.newArticleSuggestions).toEqual(['na1']);
    expect(deletedByCollection.articleUpdateSuggestions).toEqual(['au1']);
    expect(deletedByCollection.consolidatedArticles).toEqual(['ca1']);
    expect(deletedByCollection.consolidatedSections).toEqual(['cs1']);
    // Decision arrays reset.
    expect(updatedByCollection.codeCategories?.[0]?.id).toBe('cat1');

    // Downstream editorial work untouched.
    expect(deletedByCollection.articleReviews).toBeUndefined();
    expect(deletedByCollection.sectionReviews).toBeUndefined();
    expect(deletedByCollection.consolidationCategoryReviews).toBeUndefined();
    expect(deletedByCollection.articleBacklog).toBeUndefined();
    expect(deletedByCollection.reviewComments).toBeUndefined();
    expect(deletedByCollection.articleSources).toBeUndefined();

    expect(stats.articleReviewsDeleted).toBe(0);
    expect(stats.backlogRowsDeleted).toBe(0);
    expect(stats.writingRunsDeleted).toBe(0);
    expect(stats.consolidatedArticlesDeleted).toBe(1);
    expect(stats.stagingRowsDeleted).toBe(2);
  });

  it('dropDownstream mode also deletes reviews/backlog/sources/comments', async () => {
    const stats = await resetConsolidationScope({
      specialtySlug: 'anesthesiology',
      consolidationCategories: ['Airway'],
      dropDownstream: true,
    });

    // Producer rows still gone.
    expect(deletedByCollection.consolidatedArticles).toEqual(['ca1']);
    expect(deletedByCollection.consolidatedSections).toEqual(['cs1']);

    // Downstream now deleted too.
    expect(deletedByCollection.articleReviews).toEqual(['ar1']);
    expect(deletedByCollection.sectionReviews).toEqual(['sr1']);
    expect(deletedByCollection.consolidationCategoryReviews).toEqual(['ccr1']);
    expect(deletedByCollection.articleBacklog).toEqual(['bl1']);
    expect(deletedByCollection.reviewComments?.sort()).toEqual(['rc1', 'rc2']);
    expect(deletedByCollection.articleSources).toEqual(['as1']);

    expect(stats.articleReviewsDeleted).toBe(1);
    expect(stats.sectionReviewsDeleted).toBe(1);
    expect(stats.backlogRowsDeleted).toBe(1);
    expect(stats.articleSourcesDeleted).toBe(1);
    // Two distinct article record ids are swept: the backlog row's
    // articleRecordId ('rec-1') and the orphaned parent article ('eid-1').
    expect(stats.writingRunsDeleted).toBe(2);
    expect(stats.draftsDeleted).toBe(2);
  });
});
