import { describe, expect, it } from 'vitest';
import type { CodeRecord } from '@/lib/pb/types';
import { deriveCodeCategories } from './code-categories';

function code(input: { category?: string | null; mappedAt?: string }): CodeRecord {
  return {
    id: Math.random().toString(36).slice(2),
    collectionId: 'codes',
    collectionName: 'codes',
    specialtySlug: 'cardiology',
    code: 'I10',
    ...input,
  } as CodeRecord;
}

describe('deriveCodeCategories', () => {
  it('returns an empty list for no rows', () => {
    expect(deriveCodeCategories([])).toEqual([]);
  });

  it('groups by category and counts mapped vs unmapped', () => {
    const rows = [
      code({ category: 'Arrhythmia', mappedAt: '2026-01-01 00:00:00' }),
      code({ category: 'Arrhythmia' }),
      code({ category: 'Valvular', mappedAt: '2026-01-01 00:00:00' }),
    ];
    expect(deriveCodeCategories(rows)).toEqual([
      {
        category: 'Arrhythmia',
        total: 2,
        unmapped: 1,
        mapped: 1,
        readyForConsolidation: false,
      },
      {
        category: 'Valvular',
        total: 1,
        unmapped: 0,
        mapped: 1,
        readyForConsolidation: true,
      },
    ]);
  });

  it('buckets missing categories under (uncategorized)', () => {
    const [summary] = deriveCodeCategories([code({})]);
    expect(summary.category).toBe('(uncategorized)');
  });

  it('marks a category ready only when every code is mapped', () => {
    const ready = deriveCodeCategories([
      code({ category: 'A', mappedAt: 'x' }),
      code({ category: 'A', mappedAt: 'y' }),
    ]);
    expect(ready[0].readyForConsolidation).toBe(true);
  });

  it('sorts categories alphabetically', () => {
    const cats = deriveCodeCategories([
      code({ category: 'Zeta' }),
      code({ category: 'Alpha' }),
      code({ category: 'Mid' }),
    ]).map((s) => s.category);
    expect(cats).toEqual(['Alpha', 'Mid', 'Zeta']);
  });
});
