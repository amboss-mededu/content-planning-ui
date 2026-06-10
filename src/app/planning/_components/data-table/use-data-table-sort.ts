'use client';

import { useMemo, useState } from 'react';
import type { Column, SortState } from './types';
import { compareTyped } from './value-utils';

/** Sort state + the sorted projection of the (already filtered) row set. */
export function useDataTableSort<T>(filteredRows: T[], columns: Column<T>[]) {
  const [sort, setSort] = useState<SortState>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.accessor) return filteredRows;
    const acc = col.accessor;
    const type = col.type ?? 'string';
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      // Nullish values always sort to the end regardless of direction so
      // toggling asc/desc doesn't make empty rows jump around.
      const aMissing = av === null || av === undefined || av === '';
      const bMissing = bv === null || bv === undefined || bv === '';
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      const cmp = compareTyped(av, bv, type);
      return cmp * factor;
    });
  }, [filteredRows, columns, sort]);

  const onSortSet = (key: string, dir: 'asc' | 'desc' | null) => {
    setSort(dir === null ? null : { key, dir });
  };

  return { sort, setSort, sortedRows, onSortSet };
}
