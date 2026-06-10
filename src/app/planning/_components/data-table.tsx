'use client';

import { Button, Text, Tooltip } from '@amboss/design-system';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/lib/error-message';
import { PlainBody, VirtualizedBody } from './data-table/body';
import { ColumnsMenu } from './data-table/columns-menu';
import {
  BLANKS_FILTER_VALUE,
  COLUMN_HEADER_STICKY_TOP_GROUPED,
  DEFAULT_ROW_STRIPE,
  GROUP_STYLES,
  MIN_COLUMN_WIDTH,
  miniButtonStyle,
  VIRTUALIZE_THRESHOLD,
  VIRTUALIZED_HEADER_PX,
} from './data-table/constants';
import type {
  BodyProps,
  Column,
  EditableConfig,
  NumericFilter,
  NumOp,
  SortState,
} from './data-table/types';
import {
  compareNum,
  compareTyped,
  computeGroupRuns,
  effectiveWidth,
  stringifyValue,
} from './data-table/value-utils';

export type { Column, ColumnGroup, EditableConfig } from './data-table/types';

export function DataTable<T>({
  rows,
  columns,
  emptyText = 'No rows to display.',
  getRowKey,
  getRowStyle,
  onRowClick,
  onVisibleRowsChange,
  leadingNote,
  countAddendum,
  storageKey,
  leftActions,
}: {
  rows: T[];
  columns: Column<T>[];
  emptyText?: string;
  getRowKey: (row: T, index: number) => string;
  /** Optional per-row style overlay. Returned styles apply to the `<tr>`
   *  and override the default zebra stripe — used by review-pass tinting
   *  to show approved (green) / rejected (red) rows. */
  getRowStyle?: (row: T, index: number) => CSSProperties | undefined;
  /** Optional click handler on the row's `<tr>`. When set, the row
   *  picks up a pointer cursor. Cells that need to handle their own
   *  clicks (inline selects, buttons) must `stopPropagation` so they
   *  don't also trigger this handler. */
  onRowClick?: (row: T, index: number) => void;
  /** Fires whenever the currently-visible row set changes (after the
   *  table's filters + sort are applied). The parent can plumb this
   *  into a review modal so editors can stamp through "what's
   *  filtered" rather than the full list. */
  onVisibleRowsChange?: (rows: T[]) => void;
  /** Short caption appended after the row count with a `·` separator. Use
   *  `countAddendum` instead when you want a parenthetical that depends on
   *  the live filtered set. */
  leadingNote?: string;
  /** Optional parenthetical appended to the row count, computed from the
   *  current filtered set. Returning `undefined` (or an empty string)
   *  suppresses the parenthetical entirely. Receives `filteredRows` so the
   *  caller can compute domain-specific summaries (e.g. "X mapped"). */
  countAddendum?: (filteredRows: T[]) => string | undefined;
  /** When set, the table's interactive state — sort, numeric + string
   *  filters, hidden columns, drag-resized widths — is persisted to
   *  `localStorage` under this key and reloaded on the next mount. Pick a
   *  key that's stable per view (e.g. `codes-table:<specialtySlug>`).
   *  Without it the table behaves the same as before: state is in-memory
   *  only and resets on navigation. */
  storageKey?: string;
  /** Optional content rendered at the left edge of the toolbar action
   *  row (before the Columns / Reset sort / Clear filters buttons).
   *  Callers use this to inject view-toggle buttons or other table-
   *  scoped controls without duplicating the toolbar layout. */
  leftActions?: ReactNode;
}) {
  const [sort, setSort] = useState<SortState>(null);
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
  // Per-column width overrides, applied via `<colgroup>` so both header and
  // body cells resize together. Keyed by column.key and populated by dragging
  // the handle in each HeaderCell.
  const [widths, setWidths] = useState<Record<string, number>>({});
  const setColumnWidth = (key: string, px: number) =>
    setWidths((prev) => ({ ...prev, [key]: Math.max(MIN_COLUMN_WIDTH, Math.round(px)) }));
  // Per-table hidden-column set, toggled from the Columns menu in the toolbar.
  // Lives in component state (not URL or storage) so navigating away resets
  // the view — matches the existing sort/width state lifetime. Seeded from
  // any columns marked `defaultHidden`; persisted state (if storageKey is
  // set) overrides this in the hydrate effect below.
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
  );
  const visibleColumns = useMemo(
    () => columns.filter((c) => !hidden.has(c.key)),
    [columns, hidden],
  );
  const toggleHidden = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Persisted-state plumbing. `hydrated` flips to true after the load
  // effect runs. State (not a ref) so the persist effect re-runs with
  // the loaded values — a ref version had a race where the persist
  // effect's first run used the closure's still-empty initial state
  // and overwrote the saved widths/filters with `{}` on every remount.
  const [hydrated, setHydrated] = useState(false);
  // Derived-state reset: if storageKey changes (e.g. /sections toggling
  // between section and article view), reset `hydrated` SYNCHRONOUSLY
  // during render so the persist effect doesn't fire one tick with the
  // old state values keyed under the new storageKey.
  const lastStorageKey = useRef<string | undefined>(storageKey);
  if (lastStorageKey.current !== storageKey) {
    lastStorageKey.current = storageKey;
    setHydrated(false);
  }
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      setHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          v?: number;
          sort?: SortState;
          numFilters?: Record<string, NumericFilter | null>;
          // Persisted format historically stored a single string per column
          // (pre-multi-select). Accept either shape and normalize on load.
          stringFilters?: Record<string, string | string[] | null>;
          textFilters?: Record<string, string | null>;
          hidden?: string[];
          widths?: Record<string, number>;
        };
        if (parsed.v === 1) {
          if (parsed.sort !== undefined) setSort(parsed.sort);
          if (parsed.numFilters) setNumFilters(parsed.numFilters);
          if (parsed.stringFilters) {
            const normalized: Record<string, string[] | null> = {};
            for (const [k, v] of Object.entries(parsed.stringFilters)) {
              if (v === null || v === undefined || v === '') normalized[k] = null;
              else if (Array.isArray(v)) normalized[k] = v.length > 0 ? v : null;
              else normalized[k] = [v];
            }
            setStringFilters(normalized);
          }
          if (parsed.textFilters) setTextFilters(parsed.textFilters);
          if (Array.isArray(parsed.hidden)) setHidden(new Set(parsed.hidden));
          if (parsed.widths) setWidths(parsed.widths);
        }
      }
    } catch {
      // Corrupted entry — fall back to defaults silently rather than crashing.
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          v: 1,
          sort,
          numFilters,
          stringFilters,
          textFilters,
          hidden: [...hidden],
          widths,
        }),
      );
    } catch {
      // QuotaExceeded or storage disabled — non-fatal; user just loses
      // persistence for this session.
    }
  }, [
    storageKey,
    hydrated,
    sort,
    numFilters,
    stringFilters,
    textFilters,
    hidden,
    widths,
  ]);

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

  // Notify parent of the live visible-rows set whenever it changes.
  // Used by callers wiring the review modal to "review what's filtered"
  // — the modal walks `sortedRows` order so the editor sees rows in
  // the same order the table just sorted them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable callback signature; we deliberately don't include onVisibleRowsChange to allow inline functions without churn.
  useEffect(() => {
    onVisibleRowsChange?.(sortedRows);
  }, [sortedRows]);

  if (rows.length === 0) {
    return <Text color="secondary">{emptyText}</Text>;
  }
  const Body = sortedRows.length > VIRTUALIZE_THRESHOLD ? VirtualizedBody : PlainBody;

  return (
    <div
      // The `ds-data-table` class is the typography reset that's applied
      // globally to every DataTable instance (rules in globals.css). It
      // forces Lato 14/normal across cells, headers, banners, filters and
      // form controls — overriding browser UA defaults that otherwise
      // surface system fonts in the form-control descendants.
      className="ds-data-table"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {(() => {
          // Auto row-count: shows "Showing X of Y rows" while any filter is
          // narrowing the set, otherwise just "Y rows". Computed inside the
          // table so it stays in sync with the live filter state — parents
          // can't see `filteredRows` from the outside. Optional `leadingNote`
          // is appended after the count for callers that want extra context.
          const total = rows.length;
          const shown = filteredRows.length;
          const countText =
            shown === total
              ? `${total.toLocaleString()} rows`
              : `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} rows`;
          const addendum = countAddendum?.(filteredRows);
          const withAddendum =
            addendum && addendum.trim() !== '' ? `${countText} (${addendum})` : countText;
          const text = leadingNote ? `${withAddendum} · ${leadingNote}` : withAddendum;
          return (
            <Text size="s" color="secondary">
              {text}
            </Text>
          );
        })()}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {leftActions}
          <ColumnsMenu columns={columns} hidden={hidden} onToggle={toggleHidden} />
          <Button
            variant="tertiary"
            size="s"
            onClick={() => setSort(null)}
            disabled={sort === null}
          >
            Reset sort
          </Button>
          <Button
            variant="tertiary"
            size="s"
            onClick={clearFilters}
            disabled={!hasActiveFilter}
          >
            Clear filters
          </Button>
        </div>
      </div>
      <Body
        rows={sortedRows}
        columns={visibleColumns}
        getRowKey={getRowKey}
        getRowStyle={getRowStyle}
        onRowClick={onRowClick}
        sort={sort}
        onSortSet={onSortSet}
        numFilters={numFilters}
        onNumFilterChange={(key, next) =>
          setNumFilters((prev) => ({ ...prev, [key]: next }))
        }
        stringFilters={stringFilters}
        onStringFilterChange={setStringFilter}
        textFilters={textFilters}
        onTextFilterChange={setTextFilter}
        uniqueFilterValues={uniqueFilterValues}
        blanksByColumn={blanksByColumn}
        widths={widths}
        onResize={setColumnWidth}
      />
    </div>
  );
}
