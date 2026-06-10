import { describe, expect, it } from 'vitest';
import type { Column } from './types';
import {
  compareNum,
  compareTyped,
  computeGroupRuns,
  effectiveWidth,
  stringifyValue,
} from './value-utils';

describe('stringifyValue', () => {
  it('returns undefined for nullish input', () => {
    expect(stringifyValue(null)).toBeUndefined();
    expect(stringifyValue(undefined)).toBeUndefined();
  });

  it('ISO-stringifies dates and String()s everything else', () => {
    expect(stringifyValue(new Date('2026-01-02T03:04:05Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    expect(stringifyValue(7)).toBe('7');
    expect(stringifyValue(false)).toBe('false');
  });
});

describe('compareTyped', () => {
  it('compares numbers numerically with non-numeric coerced to 0', () => {
    expect(compareTyped(2, 10, 'number')).toBeLessThan(0);
    expect(compareTyped('abc', 1, 'number')).toBeLessThan(0);
  });

  it('compares dates by timestamp from Date or string input', () => {
    expect(compareTyped(new Date('2026-01-01'), '2026-02-01', 'date')).toBeLessThan(0);
  });

  it('compares booleans false-first', () => {
    expect(compareTyped(false, true, 'boolean')).toBeLessThan(0);
    expect(compareTyped(true, true, 'boolean')).toBe(0);
  });

  it('compares strings with numeric-aware collation', () => {
    expect(compareTyped('item2', 'item10', 'string')).toBeLessThan(0);
  });
});

describe('compareNum', () => {
  it('implements every operator', () => {
    expect(compareNum(5, '>', 4)).toBe(true);
    expect(compareNum(5, '>=', 5)).toBe(true);
    expect(compareNum(5, '<', 6)).toBe(true);
    expect(compareNum(5, '<=', 5)).toBe(true);
    expect(compareNum(5, '=', 5)).toBe(true);
    expect(compareNum(5, '!=', 4)).toBe(true);
    expect(compareNum(5, '=', 4)).toBe(false);
  });
});

describe('effectiveWidth', () => {
  const col: Column<unknown> = { key: 'a', label: 'A', render: () => null, width: 120 };

  it('prefers the user-dragged override', () => {
    expect(effectiveWidth(col, { a: 200 })).toBe(200);
  });

  it('falls back to the column definition width', () => {
    expect(effectiveWidth(col, {})).toBe(120);
    expect(effectiveWidth({ ...col, width: undefined }, {})).toBeUndefined();
  });
});

describe('computeGroupRuns', () => {
  const col = (key: string, group?: Column<unknown>['group']): Column<unknown> => ({
    key,
    label: key,
    render: () => null,
    group,
  });

  it('merges adjacent columns of the same group into one run', () => {
    const runs = computeGroupRuns([
      col('a', 'metadata'),
      col('b', 'metadata'),
      col('c', 'coverage'),
      col('d'),
      col('e'),
    ]);
    expect(runs).toEqual([
      { group: 'metadata', startKey: 'a', colSpan: 2 },
      { group: 'coverage', startKey: 'c', colSpan: 1 },
      { group: undefined, startKey: 'd', colSpan: 2 },
    ]);
  });

  it('does not merge same group across a gap', () => {
    const runs = computeGroupRuns([col('a', 'metadata'), col('b'), col('c', 'metadata')]);
    expect(runs.map((r) => r.colSpan)).toEqual([1, 1, 1]);
  });
});
