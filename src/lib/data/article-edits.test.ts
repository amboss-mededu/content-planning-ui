import { describe, expect, it } from 'vitest';
import type { ConsolidatedArticleRecord } from '@/lib/pb/types';
import {
  codeKeyOf,
  computeMergedArticleFields,
  dedupeCodesByCode,
  toStringArray,
} from './article-edits';

function article(over: Partial<ConsolidatedArticleRecord>): ConsolidatedArticleRecord {
  return {
    id: over.id ?? 'id',
    specialtySlug: 'test',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'consolidatedArticles',
    ...over,
  } as ConsolidatedArticleRecord;
}

describe('codeKeyOf', () => {
  it('reads a bare string entry', () => {
    expect(codeKeyOf('A01')).toBe('A01');
  });
  it('reads the code field of an object entry', () => {
    expect(codeKeyOf({ code: 'B02', description: 'x' })).toBe('B02');
  });
  it('returns null for blanks and unkeyed entries', () => {
    expect(codeKeyOf('   ')).toBeNull();
    expect(codeKeyOf({})).toBeNull();
    expect(codeKeyOf(null)).toBeNull();
    expect(codeKeyOf(42)).toBeNull();
  });
});

describe('dedupeCodesByCode', () => {
  it('dedupes by code string, last-write-wins, preserving first-seen order', () => {
    const out = dedupeCodesByCode([
      { code: 'A', description: 'first' },
      { code: 'B', description: 'b' },
      { code: 'A', description: 'second' },
    ]);
    expect(out).toEqual([
      { code: 'A', description: 'second' },
      { code: 'B', description: 'b' },
    ]);
  });
  it('drops entries with no resolvable code', () => {
    expect(dedupeCodesByCode([{ code: 'A' }, {}, 'B', '  '])).toEqual([
      { code: 'A' },
      'B',
    ]);
  });
});

describe('toStringArray', () => {
  it('keeps non-blank strings and drops everything else', () => {
    expect(toStringArray(['a', '', '  b ', 3, null, { x: 1 }])).toEqual(['a', 'b']);
  });
  it('returns [] for non-arrays', () => {
    expect(toStringArray(undefined)).toEqual([]);
    expect(toStringArray('a')).toEqual([]);
  });
});

describe('computeMergedArticleFields', () => {
  it('unions codes, maxes importance, concats justification, collects prior titles', () => {
    const target = article({
      articleTitle: 'Target',
      codes: [{ code: 'A', coverageScore: 4 }],
      overallImportance: 3,
      justification: 'tj',
      previousArticleTitleSuggestions: ['Old A'],
    });
    const source = article({
      id: 's1',
      articleTitle: 'Source',
      codes: [
        { code: 'A', coverageScore: 2 },
        { code: 'B', coverageScore: 6 },
      ],
      overallImportance: 5,
      justification: 'sj',
      previousArticleTitleSuggestions: ['Old B'],
    });

    const merged = computeMergedArticleFields(target, [source]);

    // union by code, last-write-wins (source's A overwrites target's A)
    expect(merged.codes).toEqual([
      { code: 'A', coverageScore: 2 },
      { code: 'B', coverageScore: 6 },
    ]);
    expect(merged.numCodes).toBe(2);
    // average of 2 and 6
    expect(merged.overallCoverage).toBe(4);
    expect(merged.overallImportance).toBe(5);
    expect(merged.justification).toBe('tj\n\nsj');
    // union of all previous + each source's current title; target title excluded
    expect(merged.previousArticleTitleSuggestions.sort()).toEqual(
      ['Old A', 'Old B', 'Source'].sort(),
    );
    expect(merged.previousArticleTitleSuggestions).not.toContain('Target');
  });

  it('leaves coverage/importance/justification undefined when absent', () => {
    const target = article({ articleTitle: 'T', codes: [] });
    const source = article({ id: 's', articleTitle: 'S', codes: [] });
    const merged = computeMergedArticleFields(target, [source]);
    expect(merged.codes).toEqual([]);
    expect(merged.numCodes).toBe(0);
    expect(merged.overallCoverage).toBeUndefined();
    expect(merged.overallImportance).toBeUndefined();
    expect(merged.justification).toBeUndefined();
    expect(merged.previousArticleTitleSuggestions).toEqual(['S']);
  });
});
