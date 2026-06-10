'use client';

import { useMemo, useState } from 'react';
import { BLANKS_FILTER_VALUE } from './constants';
import type { Column, NumericFilter } from './types';
import { compareNum, stringifyValue } from './value-utils';

/**
 * Filter state + derived row set for DataTable: numeric op/value filters,
 * categorical multi-select filters, and free-form contains filters, plus
 * the option lists the header dropdowns render from.
 */
export function useDataTableFilters<T>(rows: T[], columns: Column<T>[]) {
  const [numFilters, setNumFilters] = useState<Record<string, NumericFilter | null>>({});
  // String/categorical filters keyed by column. `null` (or absent entry) /
  // empty array means no filter; a non-empty array means "rows whose
  // `filterValue` (or accessor) matches *any* of these" (multi-select OR).
  const [stringFilters, setStringFilters] = useState<Record<string, string[] | null>>({});
  // Free-form text filters for columns with `filterMode: 'contains'`. Stores
  // the raw query per column; matching is case-insensitive substring. Kept
  // in a separate map from `stringFilters` so the two UIs (multi-select vs
  // text input) don't share state and can't confuse each other.
  const [textFilters, setTextFilters] = useState<Record<string, string | null>>({});

  const filteredRows = useMemo(() => {
    const numEntries = Object.entries(numFilters).filter(
      ([, f]) => f !== null && !Number.isNaN(f.value),
    ) as Array<[string, NumericFilter]>;
    const strEntries = Object.entries(stringFilters).filter(
      ([, v]) => Array.isArray(v) && v.length > 0,
    ) as Array<[string, string[]]>;
    const txtEntries = Object.entries(textFilters).filter(
      ([, v]) => typeof v === 'string' && v.trim() !== '',
    ) as Array<[string, string]>;
    if (numEntries.length === 0 && strEntries.length === 0 && txtEntries.length === 0)
      return rows;
    const numBindings = numEntries.map(([key, filter]) => ({
      key,
      filter,
      col: columns.find((c) => c.key === key),
    }));
    const strBindings = strEntries.map(([key, values]) => ({
      key,
      // Set lookup so per-row matching is O(1) regardless of selection size.
      values: new Set(values),
      col: columns.find((c) => c.key === key),
    }));
    const txtBindings = txtEntries.map(([key, value]) => ({
      key,
      // Lowercase once outside the row loop — the per-row compare reuses
      // this needle against each lowercased candidate.
      needle: value.trim().toLowerCase(),
      col: columns.find((c) => c.key === key),
    }));
    return rows.filter((row) => {
      for (const { filter, col } of numBindings) {
        if (!col?.accessor) continue;
        const raw = col.accessor(row);
        if (raw === null || raw === undefined) return false;
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isNaN(n)) return false;
        if (!compareNum(n, filter.op, filter.value)) return false;
      }
      for (const { values, col } of strBindings) {
        if (!col) continue;
        const raw = col.filterValue
          ? col.filterValue(row)
          : col.accessor
            ? stringifyValue(col.accessor(row))
            : undefined;
        // Blanks are first-class: a row with no value matches iff the user
        // explicitly selected the (Blanks) sentinel. Any other selection
        // excludes blank rows, same as before.
        const isBlank = raw === undefined || raw === '';
        if (isBlank) {
          if (!values.has(BLANKS_FILTER_VALUE)) return false;
        } else if (!values.has(raw)) return false;
      }
      for (const { needle, col } of txtBindings) {
        if (!col) continue;
        const raw = col.filterValue
          ? col.filterValue(row)
          : col.accessor
            ? stringifyValue(col.accessor(row))
            : undefined;
        if (raw === undefined) return false;
        if (!raw.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [rows, columns, numFilters, stringFilters, textFilters]);

  // Unique non-empty filter values per column, computed once from the full
  // (un-filtered) row set so the dropdowns don't shrink as filters are
  // applied. Skips columns that already supply explicit `filterOptions`.
  const uniqueFilterValues = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      if (!c.filterable || c.filterOptions || c.type === 'number') continue;
      if (!c.filterValue && !c.accessor) continue;
      const set = new Set<string>();
      for (const row of rows) {
        const v = c.filterValue
          ? c.filterValue(row)
          : c.accessor
            ? stringifyValue(c.accessor(row))
            : undefined;
        if (v !== undefined && v !== '') set.add(v);
      }
      out[c.key] = [...set].sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [columns, rows]);

  // Per-column "has at least one blank row" flag for select-mode filters.
  // Drives whether the (Blanks) option appears in the filter dropdown so
  // users can isolate rows that the workflow hasn't filled in yet (unmapped
  // codes, etc.). Mirrors the `useSelectFilter` decision in HeaderMenu so
  // numeric-range and contains-mode columns are excluded.
  const blanksByColumn = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const c of columns) {
      if (!c.filterable) continue;
      // A `type: 'number'` column without explicit `filterOptions` uses the
      // numeric-range UI, which has no option list to extend. Columns that
      // promote to select mode via `filterOptions` are still candidates.
      if (c.type === 'number' && !c.filterOptions) continue;
      if (c.filterMode === 'contains') continue;
      if (!c.filterValue && !c.accessor) continue;
      let hasBlanks = false;
      for (const row of rows) {
        const v = c.filterValue
          ? c.filterValue(row)
          : c.accessor
            ? stringifyValue(c.accessor(row))
            : undefined;
        if (v === undefined || v === '') {
          hasBlanks = true;
          break;
        }
      }
      out[c.key] = hasBlanks;
    }
    return out;
  }, [columns, rows]);

  const hasActiveFilter =
    Object.values(numFilters).some((f) => f !== null && !Number.isNaN(f.value)) ||
    Object.values(stringFilters).some((v) => Array.isArray(v) && v.length > 0) ||
    Object.values(textFilters).some((v) => typeof v === 'string' && v.trim() !== '');

  const clearFilters = () => {
    setNumFilters({});
    setStringFilters({});
    setTextFilters({});
  };

  const setTextFilter = (key: string, value: string | null) =>
    setTextFilters((prev) => ({
      ...prev,
      // Empty / whitespace-only collapses to null so the active-filter
      // checks above match the no-filter representation everywhere.
      [key]: value && value.trim() !== '' ? value : null,
    }));

  const setStringFilter = (key: string, values: string[] | null) =>
    setStringFilters((prev) => ({
      ...prev,
      // Normalize empty array → null so persistence stays compact and the
      // hasActiveFilter / filter loop checks above can rely on a single
      // "no filter" representation.
      [key]: values && values.length > 0 ? values : null,
    }));

  return {
    numFilters,
    setNumFilters,
    stringFilters,
    setStringFilters,
    textFilters,
    setTextFilters,
    filteredRows,
    uniqueFilterValues,
    blanksByColumn,
    hasActiveFilter,
    clearFilters,
    setTextFilter,
    setStringFilter,
  };
}
