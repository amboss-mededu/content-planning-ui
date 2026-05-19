import { describe, expect, it } from 'vitest';
import {
  deriveBucketStats,
  deriveConsolidationMappingByCategory,
  deriveOutputCategories,
  deriveReviewCategories,
  filterCodesByConsolidationCategories,
  getConsolidationActionLabel,
  groupByConsolidationCategory,
} from './buckets';

describe('consolidation buckets', () => {
  it('derives Review rail state from consolidationCategory buckets', () => {
    const mapping = deriveConsolidationMappingByCategory([
      { consolidationCategory: 'Airway', mappedAt: 1 },
      { consolidationCategory: 'Airway', mappedAt: 2 },
      { consolidationCategory: 'Pain', mappedAt: 3 },
      { consolidationCategory: 'Pain', mappedAt: 0 },
      { consolidationCategory: null, mappedAt: 4 },
      { mappedAt: 5 },
    ]);

    expect(mapping).toEqual({
      Airway: { mapped: 2, total: 2, ready: true },
      Pain: { mapped: 1, total: 2, ready: false },
    });
    expect(deriveReviewCategories(mapping)).toEqual(['Airway', 'Pain']);
  });

  it('keeps a mapped bucket visible even when consolidation output is empty', () => {
    const mapping = deriveConsolidationMappingByCategory([
      { consolidationCategory: 'Empty-but-ready', mappedAt: 1 },
    ]);

    expect(deriveReviewCategories(mapping)).toEqual(['Empty-but-ready']);
  });

  it('filters mapped-code reads by consolidationCategory, not source category', () => {
    const rows = [
      { code: 'A', category: 'Source 1', consolidationCategory: 'Bucket 1' },
      { code: 'B', category: 'Bucket 1', consolidationCategory: 'Bucket 2' },
      { code: 'C', category: 'Bucket 2', consolidationCategory: null },
    ];

    expect(filterCodesByConsolidationCategories(rows, ['Bucket 1'])).toEqual([rows[0]]);
    expect(filterCodesByConsolidationCategories(rows, null)).toEqual([rows[0], rows[1]]);
  });

  it('groups primary consolidation output under the bucket name', () => {
    const groups = groupByConsolidationCategory([
      {
        code: 'A',
        category: 'Source 1',
        consolidationCategory: 'Bucket 1',
        description: null,
        newArticlesNeeded: [],
        existingArticleUpdates: [],
      },
      {
        code: 'B',
        category: 'Source 2',
        consolidationCategory: 'Bucket 1',
        description: null,
        newArticlesNeeded: [],
        existingArticleUpdates: [],
      },
    ]);

    expect(Array.from(groups.keys())).toEqual(['Bucket 1']);
    expect(groups.get('Bucket 1')?.map((c) => c.category)).toEqual([
      'Source 1',
      'Source 2',
    ]);
  });

  it('labels ready empty buckets differently from buckets with output', () => {
    expect(
      getConsolidationActionLabel({ hasOutput: false, isConsolidating: false }),
    ).toBe('Run consolidation');
    expect(getConsolidationActionLabel({ hasOutput: true, isConsolidating: false })).toBe(
      'Re-run consolidation',
    );
    expect(getConsolidationActionLabel({ hasOutput: false, isConsolidating: true })).toBe(
      'Rebuilding…',
    );
  });

  it('derives consolidated status from current output row bucket keys', () => {
    expect(
      deriveOutputCategories([
        { category: 'Airway' },
        { category: 'Pain' },
        { category: ' ' },
        { category: null },
      ]),
    ).toEqual(new Set(['Airway', 'Pain']));
  });

  it('leaves ready buckets pending when no current output exists', () => {
    const stats = deriveBucketStats({
      bucket: 'Airway',
      codes: ['A', 'B'],
      outputRows: [],
      decisionRows: [
        {
          excludedArticleCodes: ['B'],
          totallyIgnoredCodes: ['A'],
        },
      ],
    });

    expect(stats.hasConsolidatedOutput).toBe(false);
    expect(stats.numIncludedCodes).toBeNull();
    expect(stats.numExcludedCodes).toBeNull();
    expect(stats.numTotallyIgnoredCodes).toBeNull();
    expect(stats.numOrphanCodes).toBeNull();
    expect(Object.fromEntries(stats.statusByCode)).toEqual({
      A: 'pending',
      B: 'pending',
    });
  });

  it('counts included codes from current final output rows', () => {
    const stats = deriveBucketStats({
      bucket: 'Airway',
      codes: ['A', 'B', 'C'],
      outputRows: [
        { category: 'Airway', codes: ['A', { code: 'B' }, 'OTHER'] },
        { category: 'Pain', codes: ['C'] },
      ],
      decisionRows: [{ excludedArticleCodes: ['B', 'C'] }],
    });

    expect(stats.numIncludedCodes).toBe(2);
    expect(stats.numExcludedCodes).toBe(1);
    expect(stats.numTotallyIgnoredCodes).toBe(0);
    expect(stats.numOrphanCodes).toBe(0);
    expect(Object.fromEntries(stats.statusByCode)).toEqual({
      A: 'included',
      B: 'included',
      C: 'excluded',
    });
  });

  it('only marks missing bucket codes orphan after current output exists', () => {
    const stats = deriveBucketStats({
      bucket: 'Airway',
      codes: ['A', 'B', 'C'],
      outputRows: [{ category: 'Airway', codes: ['A'] }],
      decisionRows: [{ totallyIgnoredCodes: ['C'] }],
    });

    expect(stats.numIncludedCodes).toBe(1);
    expect(stats.numExcludedCodes).toBe(0);
    expect(stats.numTotallyIgnoredCodes).toBe(1);
    expect(stats.numOrphanCodes).toBe(1);
    expect(Object.fromEntries(stats.statusByCode)).toEqual({
      A: 'included',
      B: 'orphan',
      C: 'ignored',
    });
  });
});
