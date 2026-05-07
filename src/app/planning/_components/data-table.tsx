'use client';

import { Button, Text, Tooltip } from '@amboss/design-system';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Column definition.
 *
 * - `render`  : what shows in each cell (can be arbitrary JSX).
 * - `accessor`: opt-in sortable/filterable value extractor. Without one, the
 *               column renders but has no sort affordance.
 * - `type`    : 'string' (default) | 'number' | 'date' | 'boolean'. Drives
 *               both the sort comparator and whether the numeric-filter
 *               popover is offered. `boolean` sorts true-before-false.
 * - `filterable`: only meaningful for `type: 'number'` — adds the ▽ icon
 *               in the header that opens an operator+value popover.
 * - `editable`: opt-in inline edit. When present, the cell shows a pencil
 *               on hover; click swaps to a text input (Enter to save,
 *               Escape/blur to cancel). Save errors render inline below.
 */
export interface EditableConfig<T> {
  getValue: (row: T) => string;
  onSave: (row: T, next: string) => Promise<void>;
  multiline?: boolean;
}

export type ColumnGroup = 'metadata' | 'coverage' | 'suggestions' | 'actions';

export interface Column<T> {
  key: string;
  label: string;
  /** Plain-text description shown in a Tooltip when the user hovers on the
   *  column-header label. Omit for columns whose label is self-explanatory. */
  description?: string;
  render: (row: T) => ReactNode;
  width?: string | number;
  align?: 'left' | 'right' | 'center';
  /** Vertical alignment for body cells. Defaults to `'middle'` so badges
   *  and numbers stay centered in tall rows; set to `'top'` for columns
   *  whose content can wrap to several lines (long descriptions,
   *  justifications, category names) so the text starts at the top of
   *  the cell instead of floating in the middle. */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  accessor?: (row: T) => string | number | boolean | Date | null | undefined;
  type?: 'string' | 'number' | 'date' | 'boolean';
  /** Opts the column into the header dropdown's filter section. Number
   *  columns get the comparison UI (op + value); other columns get a
   *  single-select list of `filterOptions` (or unique values derived from
   *  `filterValue` / `accessor` when `filterOptions` is omitted). */
  filterable?: boolean;
  /** Returns the row's value for non-numeric filter matching. Defaults to
   *  stringifying `accessor`'s output. Override when sort and filter need
   *  different views (e.g. coverage rank vs level string) or when the
   *  accessor is numeric but the filter should compare a label. */
  filterValue?: (row: T) => string | undefined;
  /** Predefined filter choices (with display labels). When omitted, the
   *  unique non-empty values returned by `filterValue` (or `accessor`) are
   *  used and labelled with their raw value. */
  filterOptions?: Array<{ value: string; label: string }>;
  /** Filter UI mode for non-numeric columns. Defaults to `'select'`
   *  (multi-select dropdown of options). Use `'contains'` for free-form
   *  text columns where a checkbox list of unique values is impractical —
   *  it shows a text input that does case-insensitive substring matching
   *  against `filterValue` (or `accessor` stringified). */
  filterMode?: 'select' | 'contains';
  editable?: EditableConfig<T>;
  group?: ColumnGroup;
}

const GROUP_STYLES: Record<
  ColumnGroup,
  {
    label: string;
    bg: string;
    fg: string;
    border: string;
    /** Alternating-row tint applied to body cells in this group. Even rows
     *  render plain white; odd rows pick up `stripe` so each group reads as a
     *  shaded column band (Google Sheets-style). */
    stripe: string;
  }
> = {
  metadata: {
    label: 'Metadata',
    // `bg` colors are pre-blended over white (the page background) so the
    // sticky group banner stays opaque when rows scroll under it. `stripe`
    // stays translucent — it sits on already-opaque body cells.
    bg: 'rgb(241, 241, 242)',
    fg: 'rgba(15, 23, 42, 0.65)',
    border: 'rgba(15, 23, 42, 0.25)',
    stripe: 'rgba(15, 23, 42, 0.035)',
  },
  coverage: {
    label: 'Coverage',
    bg: 'rgb(228, 241, 234)',
    fg: 'rgb(15, 95, 50)',
    border: 'rgb(34, 139, 80)',
    stripe: 'rgba(34, 139, 80, 0.06)',
  },
  suggestions: {
    label: 'Suggestions',
    bg: 'rgb(250, 236, 220)',
    fg: 'rgb(133, 77, 14)',
    border: 'rgb(217, 119, 6)',
    stripe: 'rgba(217, 119, 6, 0.07)',
  },
  actions: {
    label: '',
    bg: 'transparent',
    fg: 'inherit',
    border: 'transparent',
    stripe: 'transparent',
  },
};

// Default zebra stripe applied to odd rows in cells that don't belong to a
// `ColumnGroup`. Same shade as the metadata-group stripe so tables with and
// without groups share the same baseline readability.
const DEFAULT_ROW_STRIPE = 'rgba(15, 23, 42, 0.035)';

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

type NumOp = '>' | '>=' | '<' | '<=' | '=' | '!=';
type NumericFilter = { op: NumOp; value: number };

// Always virtualize: only the rows in (and slightly around) the visible
// viewport are rendered, so initial paint cost stays roughly constant
// regardless of total row count. With the adaptive height in `VirtualizedBody`,
// short lists collapse to their natural size instead of locking to the
// viewport — so virtualization is safe everywhere and there's no need for a
// "small enough to render plain" carve-out.
const VIRTUALIZE_THRESHOLD = 0;

// Sentinel value used in the categorical filter to represent "rows whose
// filter value is empty/undefined". Stored in `stringFilters` like any other
// value, but special-cased in the per-row match loop so blanks become a
// first-class selectable option in select-style filters. Picked as a string
// that no real `filterValue` would produce so there's no risk of collision.
const BLANKS_FILTER_VALUE = '__amboss_blanks__';

// Approximate vertical space taken by the sticky header band (group banner +
// column header row + a small buffer). Used to compute the virtualized
// container's natural height so tables shorter than the viewport collapse
// to fit instead of being pinned to `100vh - 120px`.
const VIRTUALIZED_HEADER_PX = 80;

const MIN_COLUMN_WIDTH = 50;

/** Sticky `top` (px) for the column-header row when group banners are
 *  present. Deliberately a few px LESS than the banner's intrinsic height
 *  (~32px at 14px Lato + 6/12 padding + ~1.4 line-height) so the
 *  column-header row overlaps the banner's bottom edge. Banner has z-index
 *  2 and covers the overlap zone, so the eye sees them flush — no gap,
 *  regardless of how the browser sizes the banner. The overlapped pixels
 *  of the column header are inside its 10px top padding, not its content. */
const COLUMN_HEADER_STICKY_TOP_GROUPED = 28;

export function DataTable<T>({
  rows,
  columns,
  emptyText = 'No rows to display.',
  getRowKey,
  leadingNote,
  countAddendum,
  storageKey,
}: {
  rows: T[];
  columns: Column<T>[];
  emptyText?: string;
  getRowKey: (row: T, index: number) => string;
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
  // the view — matches the existing sort/width state lifetime.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
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

  // Persisted-state plumbing. `hydrated` flips to true after the load effect
  // runs so the save effect doesn't immediately overwrite stored state with
  // the empty defaults. Sets are serialized as arrays for JSON storage.
  const hydrated = useRef(false);
  useEffect(() => {
    hydrated.current = false;
    if (!storageKey || typeof window === 'undefined') {
      hydrated.current = true;
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
    hydrated.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !hydrated.current || typeof window === 'undefined') return;
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
  }, [storageKey, sort, numFilters, stringFilters, textFilters, hidden, widths]);

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

// ---------------------------------------------------------------------------
// Comparators.
// ---------------------------------------------------------------------------

function stringifyValue(
  v: string | number | boolean | Date | null | undefined,
): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function compareTyped(
  av: string | number | boolean | Date,
  bv: string | number | boolean | Date,
  type: 'string' | 'number' | 'date' | 'boolean',
): number {
  if (type === 'number') return (Number(av) || 0) - (Number(bv) || 0);
  if (type === 'date') {
    const a = av instanceof Date ? av.getTime() : new Date(String(av)).getTime();
    const b = bv instanceof Date ? bv.getTime() : new Date(String(bv)).getTime();
    return a - b;
  }
  if (type === 'boolean') {
    return (av ? 1 : 0) - (bv ? 1 : 0);
  }
  return String(av).localeCompare(String(bv), undefined, { numeric: true });
}

function compareNum(n: number, op: NumOp, v: number): boolean {
  switch (op) {
    case '>':
      return n > v;
    case '>=':
      return n >= v;
    case '<':
      return n < v;
    case '<=':
      return n <= v;
    case '=':
      return n === v;
    case '!=':
      return n !== v;
  }
}

// ---------------------------------------------------------------------------
// Header cell — clicking the label opens a unified sort + filter dropdown.
// Replaces the old "click to cycle sort" + separate ▽ filter button pattern.
// ---------------------------------------------------------------------------

function HeaderCell<T>({
  column,
  sort,
  onSortSet,
  numFilter,
  onNumFilterChange,
  stringFilter,
  onStringFilterChange,
  textFilter,
  onTextFilterChange,
  uniqueValues,
  hasBlanks,
  onResize,
  width,
  grouped,
}: {
  column: Column<T>;
  sort: SortState;
  onSortSet: (key: string, dir: 'asc' | 'desc' | null) => void;
  numFilter: NumericFilter | null;
  onNumFilterChange: (key: string, next: NumericFilter | null) => void;
  stringFilter: string[] | null;
  onStringFilterChange: (key: string, next: string[] | null) => void;
  textFilter: string | null;
  onTextFilterChange: (key: string, next: string | null) => void;
  uniqueValues: string[] | undefined;
  hasBlanks: boolean;
  onResize: (key: string, next: number) => void;
  width: number | string | undefined;
  grouped: boolean;
}) {
  const sortable = Boolean(column.accessor);
  const filterable = column.filterable === true;
  const isNumber = column.type === 'number';
  const isContains = column.filterMode === 'contains';
  const sortDir = sort?.key === column.key ? sort.dir : null;
  const stringFilterCount = stringFilter?.length ?? 0;
  const textFilterActive = typeof textFilter === 'string' && textFilter.trim() !== '';
  const filterActive = isNumber
    ? Boolean(numFilter)
    : isContains
      ? textFilterActive
      : stringFilterCount > 0;
  const interactable = sortable || filterable;
  const thRef = useRef<HTMLTableCellElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // fontWeight is set explicitly here (rather than inherited from the <th>)
  // because the DS Tooltip wrapper introduces its own typography context
  // that breaks `font-weight: inherit` — without this, the bold weight gets
  // dropped on tooltip-wrapped headers.
  const labelEl = <span style={{ fontWeight: 600 }}>{column.label}</span>;
  const labelWithTooltip = column.description ? (
    <Tooltip content={column.description}>{labelEl}</Tooltip>
  ) : (
    labelEl
  );

  const startResize = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = thRef.current?.getBoundingClientRect().width ?? MIN_COLUMN_WIDTH;
    const onMove = (ev: MouseEvent) => {
      onResize(column.key, startWidth + (ev.clientX - startX));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <th
      ref={thRef}
      scope="col"
      style={{
        // Header labels always left-align even when the cell content is
        // right- or center-aligned (e.g. numeric columns). Cell alignment
        // is handled separately in the body so numbers still line up on
        // the right while their header reads naturally on the left.
        textAlign: 'left',
        padding: '10px 12px',
        borderBottom: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
        // Vertical divider between columns so the resize handle's position
        // is visually obvious. The handle is a 6px-wide invisible strip on
        // the right edge — without a divider users couldn't tell where one
        // column ended and the next began.
        borderRight: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
        // Column-header labels are semibold so they stand off the body
        // rows. The group-banner row (rendered separately in `Header`)
        // intentionally stays at 400 — its colored band is the group
        // affordance, and bolding both rows would flatten the hierarchy.
        fontWeight: 600,
        whiteSpace: 'nowrap',
        width,
        // Opaque so rows don't bleed through when the header is sticky.
        // Approx. equivalent of the prior `rgba(0,0,0,0.02)` over white.
        background: 'rgb(250, 250, 250)',
        position: 'sticky',
        // Sits a few px BEHIND the banner row's bottom edge, deliberately
        // overlapping so no body rows peek through between them. The banner
        // (z-index 2) covers the overlap zone. Kept at z=1 so DS
        // Combobox/Select dropdowns (portaled to body with their default
        // z-index of 1) aren't visually obscured — the HeaderMenu portals
        // separately with a higher z-index so it still appears above.
        top: grouped ? COLUMN_HEADER_STICKY_TOP_GROUPED : 0,
        zIndex: 1,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          // Always start-align the header content (label + sort/filter
          // glyph) regardless of the column's body alignment.
          justifyContent: 'flex-start',
        }}
      >
        {interactable ? (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            style={{
              background: filterActive
                ? 'var(--ads-c-surface-accent, rgba(0, 90, 180, 0.12))'
                : 'none',
              border: '1px solid transparent',
              borderRadius: 3,
              padding: '1px 4px',
              font: 'inherit',
              // Explicit semibold so user-agent button styles don't reset
              // back to normal weight inside the inflex of <button>.
              fontWeight: 600,
              color: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {labelWithTooltip}
            <span
              aria-hidden
              style={{
                fontSize: 11,
                color: sortDir
                  ? 'inherit'
                  : 'var(--ads-c-text-secondary, rgba(0,0,0,0.35))',
              }}
            >
              {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : '⇅'}
            </span>
            {filterActive ? (
              <span
                aria-hidden
                style={{
                  fontSize: 11,
                  color: 'var(--ads-c-text-accent, #0055aa)',
                  fontWeight: 700,
                }}
              >
                {stringFilterCount > 1 ? `(${stringFilterCount})` : '●'}
              </span>
            ) : null}
          </button>
        ) : (
          labelWithTooltip
        )}
      </div>
      {menuOpen ? (
        <HeaderMenu
          column={column}
          sortable={sortable}
          filterable={filterable}
          isNumber={isNumber}
          isContains={isContains}
          sortDir={sortDir}
          numFilter={numFilter}
          stringFilter={stringFilter}
          textFilter={textFilter}
          uniqueValues={uniqueValues}
          hasBlanks={hasBlanks}
          anchorRef={buttonRef}
          onClose={() => setMenuOpen(false)}
          onSortSet={(dir) => {
            onSortSet(column.key, dir);
            setMenuOpen(false);
          }}
          onNumFilterChange={(next) => {
            onNumFilterChange(column.key, next);
          }}
          onStringFilterChange={(next) => {
            onStringFilterChange(column.key, next);
          }}
          onTextFilterChange={(next) => {
            onTextFilterChange(column.key, next);
          }}
        />
      ) : null}
      {/* Drag-to-resize handle — a thin strip on the right edge. Sits on top
          of the column border so users can grab between columns. Purely a
          pointer affordance; screen readers use column labels for structure. */}
      <div
        aria-hidden
        title={`Drag to resize ${column.label}`}
        onMouseDown={startResize}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResize(column.key, MIN_COLUMN_WIDTH);
        }}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width: 6,
          cursor: 'col-resize',
          userSelect: 'none',
          touchAction: 'none',
        }}
      />
    </th>
  );
}

// ---------------------------------------------------------------------------
// Header dropdown — sort + filter actions for a single column. Portals to
// document.body so it sits above the sticky banner (z=2) and any other DS
// surfaces. Anchored to the header button via a getBoundingClientRect coord
// recompute on resize / ancestor scroll.
// ---------------------------------------------------------------------------

function HeaderMenu<T>({
  column,
  sortable,
  filterable,
  isNumber,
  isContains,
  sortDir,
  numFilter,
  stringFilter,
  textFilter,
  uniqueValues,
  hasBlanks,
  anchorRef,
  onClose,
  onSortSet,
  onNumFilterChange,
  onStringFilterChange,
  onTextFilterChange,
}: {
  column: Column<T>;
  sortable: boolean;
  filterable: boolean;
  isNumber: boolean;
  isContains: boolean;
  sortDir: 'asc' | 'desc' | null;
  numFilter: NumericFilter | null;
  stringFilter: string[] | null;
  textFilter: string | null;
  uniqueValues: string[] | undefined;
  hasBlanks: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSortSet: (dir: 'asc' | 'desc' | null) => void;
  onNumFilterChange: (next: NumericFilter | null) => void;
  onStringFilterChange: (next: string[] | null) => void;
  onTextFilterChange: (next: string | null) => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const [op, setOp] = useState<NumOp>(numFilter?.op ?? '>=');
  const [numStr, setNumStr] = useState<string>(
    numFilter?.value !== undefined ? String(numFilter.value) : '',
  );
  // A column whose `type` is 'number' (for sort/comparator) but which supplies
  // a fixed `filterOptions` list is categorical for *filtering* purposes —
  // the rank is just for ordering. Treat those as dropdown filters; the
  // numeric op+value UI is reserved for free-form numeric ranges.
  const useNumericFilter = isNumber && !column.filterOptions;
  // 'contains' takes precedence over the multi-select UI — both are
  // non-numeric, but the column author has explicitly opted into free-form
  // text search.
  const useContainsFilter = !useNumericFilter && isContains;
  const useSelectFilter = !useNumericFilter && !useContainsFilter;

  // Recompute anchor coords on open and any layout-affecting change.
  useEffect(() => {
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  // Click-outside / Escape dismiss.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  const applyNumFilter = () => {
    const n = Number(numStr);
    if (Number.isNaN(n) || numStr.trim() === '') {
      onNumFilterChange(null);
    } else {
      onNumFilterChange({ op, value: n });
    }
    onClose();
  };

  if (!coords || typeof document === 'undefined') return null;

  // Resolve the option list for non-numeric filters: explicit `filterOptions`
  // wins (preserves order + custom labels), else fall back to unique values.
  // When the column has at least one blank row, prepend a (Blanks) sentinel
  // so users can isolate or exclude the empty side of the column. We only
  // add it for the select-style path — numeric ranges and contains don't
  // have an option list and have no equivalent affordance here yet.
  const baseOptions =
    column.filterOptions ?? (uniqueValues ?? []).map((v) => ({ value: v, label: v }));
  const options =
    hasBlanks && useSelectFilter
      ? [{ value: BLANKS_FILTER_VALUE, label: '(Blanks)' }, ...baseOptions]
      : baseOptions;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${column.label} options`}
      style={{
        position: 'fixed',
        top: coords.top,
        right: coords.right,
        background: 'var(--ads-c-surface, white)',
        border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        padding: 6,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 220,
        // Cap the popover width so long category names (e.g. "Disorders of
        // the autonomic nervous system") wrap to multiple lines instead of
        // making the dropdown grow horizontally across the table.
        maxWidth: 320,
        maxHeight: '60vh',
        overflowY: 'auto',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && filterable && useNumericFilter) {
          e.preventDefault();
          applyNumFilter();
        }
      }}
    >
      {sortable ? (
        <>
          <MenuSectionLabel>Sort</MenuSectionLabel>
          <MenuItem
            active={sortDir === 'asc'}
            onClick={() => onSortSet(sortDir === 'asc' ? null : 'asc')}
          >
            Sort ascending
          </MenuItem>
          <MenuItem
            active={sortDir === 'desc'}
            onClick={() => onSortSet(sortDir === 'desc' ? null : 'desc')}
          >
            Sort descending
          </MenuItem>
          {sortDir ? (
            <MenuItem onClick={() => onSortSet(null)}>Clear sort</MenuItem>
          ) : null}
        </>
      ) : null}

      {filterable && useNumericFilter ? (
        <>
          {sortable ? <MenuDivider /> : null}
          <MenuSectionLabel>Filter</MenuSectionLabel>
          <div style={{ display: 'flex', gap: 6, padding: '4px 6px' }}>
            <select
              value={op}
              onChange={(e) => setOp(e.target.value as NumOp)}
              style={{
                padding: '4px 6px',
                border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
                borderRadius: 4,
                fontSize: 13,
                // Form controls have their own UA-default font; inherit so
                // they pick up the body's Lato instead of the platform UI font.
                fontFamily: 'inherit',
              }}
            >
              <option value=">=">≥</option>
              <option value=">">{'>'}</option>
              <option value="<=">≤</option>
              <option value="<">{'<'}</option>
              <option value="=">=</option>
              <option value="!=">≠</option>
            </select>
            <input
              type="number"
              value={numStr}
              onChange={(e) => setNumStr(e.target.value)}
              placeholder="value"
              style={{
                flex: 1,
                padding: '4px 6px',
                border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
                borderRadius: 4,
                fontSize: 13,
                minWidth: 0,
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 6,
              justifyContent: 'flex-end',
              padding: '4px 6px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                onNumFilterChange(null);
                onClose();
              }}
              style={{
                background: 'none',
                border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={applyNumFilter}
              style={{
                background: 'var(--ads-c-surface-accent-bold, #0055aa)',
                color: 'var(--ads-c-text-on-accent, white)',
                border: 'none',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        </>
      ) : null}

      {filterable && useSelectFilter ? (
        <CategoricalFilter
          options={options}
          selected={stringFilter ?? []}
          showSortDivider={sortable}
          onChange={onStringFilterChange}
          onClose={onClose}
        />
      ) : null}

      {filterable && useContainsFilter ? (
        <ContainsFilter
          value={textFilter}
          showSortDivider={sortable}
          onChange={onTextFilterChange}
          onClose={onClose}
        />
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * Multi-select filter section rendered inside the header dropdown for
 * categorical columns. Shows a typeahead that narrows the option list, a
 * row of bulk affordances ("All" / "None" scoped to the current matches),
 * and a checkbox per option. Closes are caller-controlled — selection
 * doesn't auto-close so users can pick several values in one open.
 */
function CategoricalFilter({
  options,
  selected,
  showSortDivider,
  onChange,
  onClose,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  showSortDivider: boolean;
  onChange: (next: string[] | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Auto-focus the search field when the menu opens. Using a ref-effect (vs
  // `autoFocus`) avoids the JSX-a11y lint hit and keeps the focus behavior
  // explicit at mount time.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      const next = selected.filter((v) => v !== value);
      onChange(next.length > 0 ? next : null);
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAllVisible = () => {
    const next = new Set(selected);
    for (const o of visibleOptions) next.add(o.value);
    onChange(next.size > 0 ? [...next] : null);
  };

  const clearVisible = () => {
    if (visibleOptions.length === options.length) {
      // No active query — "None" clears everything.
      onChange(null);
      return;
    }
    const visibleVals = new Set(visibleOptions.map((o) => o.value));
    const next = selected.filter((v) => !visibleVals.has(v));
    onChange(next.length > 0 ? next : null);
  };

  return (
    <>
      {showSortDivider ? <MenuDivider /> : null}
      <MenuSectionLabel>
        Filter{selected.length > 0 ? ` · ${selected.length} selected` : ''}
      </MenuSectionLabel>
      <div style={{ padding: '4px 6px' }}>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          onKeyDown={(e) => {
            // Enter on a single visible result is a quick "toggle this one"
            // shortcut. Escape bubbles up to the popover for dismiss.
            if (e.key === 'Enter' && visibleOptions.length === 1) {
              e.preventDefault();
              toggle(visibleOptions[0].value);
            }
          }}
          style={{
            width: '100%',
            padding: '4px 8px',
            border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
            borderRadius: 4,
            fontSize: 13,
            font: 'inherit',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '0 6px 4px',
          fontSize: 12,
        }}
      >
        <button
          type="button"
          onClick={selectAllVisible}
          disabled={visibleOptions.length === 0}
          style={miniButtonStyle}
        >
          {query ? 'Select matches' : 'Select all'}
        </button>
        <button type="button" onClick={clearVisible} style={miniButtonStyle}>
          {query ? 'Clear matches' : 'Clear'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ ...miniButtonStyle, marginLeft: 'auto' }}
        >
          Done
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {visibleOptions.length === 0 ? (
          <div
            style={{
              padding: '8px 10px',
              fontSize: 12,
              color: 'var(--ads-c-text-secondary, rgba(0,0,0,0.55))',
            }}
          >
            No matches.
          </div>
        ) : (
          visibleOptions.map((opt) => {
            const checked = selectedSet.has(opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  // Top-align so the checkbox lines up with the first line
                  // of a wrapped label rather than centering against the
                  // whole multi-line block.
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '5px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  background: checked
                    ? 'var(--ads-c-surface-accent, rgba(0, 90, 180, 0.10))'
                    : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!checked) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!checked) e.currentTarget.style.background = 'transparent';
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  // Prevent the checkbox from shrinking when the label
                  // wraps to multiple lines.
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <span
                  style={{
                    // Wrap long values (e.g. multi-word category names)
                    // instead of forcing the popover to grow horizontally.
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    lineHeight: 1.35,
                  }}
                >
                  {opt.label}
                </span>
              </label>
            );
          })
        )}
      </div>
    </>
  );
}

const miniButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 12,
  cursor: 'pointer',
  font: 'inherit',
};

/**
 * Free-form text filter section rendered inside the header dropdown for
 * columns with `filterMode: 'contains'`. Used for free-form fields like
 * Description where a checkbox list of unique values would be useless. Keeps
 * a local draft so the row set isn't re-filtered on every keystroke; commits
 * on blur, Enter, or Apply. Esc reverts the draft to the committed value.
 */
function ContainsFilter({
  value,
  showSortDivider,
  onChange,
  onClose,
}: {
  value: string | null;
  showSortDivider: boolean;
  onChange: (next: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string>(value ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Auto-focus the search box on open. Mirrors CategoricalFilter behavior so
  // both filter modes feel identical to the keyboard.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Pull the committed value back into the draft if the parent clears the
  // filter externally (e.g. via the toolbar's "Clear filters" button).
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const apply = () => {
    onChange(draft.trim() === '' ? null : draft);
    onClose();
  };

  const clear = () => {
    setDraft('');
    onChange(null);
  };

  return (
    <>
      {showSortDivider ? <MenuDivider /> : null}
      <MenuSectionLabel>Contains{value ? ' · active' : ''}</MenuSectionLabel>
      <div style={{ padding: '4px 6px' }}>
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(value ?? '');
              onClose();
            }
          }}
          placeholder="Type to filter…"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
            borderRadius: 4,
            fontSize: 13,
            font: 'inherit',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '0 6px 4px',
          fontSize: 12,
        }}
      >
        <button type="button" onClick={clear} style={miniButtonStyle}>
          Clear
        </button>
        <button
          type="button"
          onClick={apply}
          style={{ ...miniButtonStyle, marginLeft: 'auto' }}
        >
          Apply
        </button>
      </div>
    </>
  );
}

function MenuSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--ads-c-text-secondary, rgba(0,0,0,0.6))',
        fontWeight: 700,
        padding: '6px 8px 2px',
      }}
    >
      {children}
    </div>
  );
}

function MenuDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--ads-c-divider, rgba(0,0,0,0.08))',
        margin: '4px 0',
      }}
    />
  );
}

function MenuItem({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: active
          ? 'var(--ads-c-surface-accent, rgba(0, 90, 180, 0.12))'
          : 'none',
        color: active ? 'var(--ads-c-text-accent, #0055aa)' : 'inherit',
        border: 'none',
        borderRadius: 4,
        padding: '6px 8px',
        fontSize: 13,
        font: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Columns menu — toolbar dropdown for toggling per-column visibility.
// ---------------------------------------------------------------------------

/**
 * Toolbar dropdown that lists every column with a visibility checkbox. Hidden
 * keys live in `hidden`; toggling a row adds/removes from the set. Mirrors
 * the portal+positioning pattern used by `NumericFilterMenu` so the popover
 * sits above the sticky header bands.
 */
function ColumnsMenu<T>({
  columns,
  hidden,
  onToggle,
}: {
  columns: Column<T>[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const hiddenCount = hidden.size;

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const popover =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Toggle columns"
            style={{
              position: 'fixed',
              top: coords.top,
              right: coords.right,
              background: 'var(--ads-c-surface, white)',
              border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              padding: 8,
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 220,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            {columns.map((c) => {
              const visible = !hidden.has(c.key);
              return (
                <label
                  key={c.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1.3,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onToggle(c.key)}
                  />
                  <span>{c.label}</span>
                </label>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <Button
        ref={buttonRef}
        variant="tertiary"
        size="s"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {`Columns${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''} ▾`}
      </Button>
      {popover}
    </>
  );
}

// ---------------------------------------------------------------------------
// Body cells (shared).
// ---------------------------------------------------------------------------

function TableCells<T>({
  row,
  columns,
  rowIndex,
}: {
  row: T;
  columns: Column<T>[];
  rowIndex: number;
}) {
  // Odd rows pick up a stripe tint so the table reads as a zebra pattern.
  // For grouped columns the tint is the group's color (light blue-grey for
  // metadata, light green for coverage, light orange for suggestions); for
  // ungrouped columns and tables without groups, fall back to the default
  // grey so every table has the same readability without each call site
  // having to opt in. Even rows stay plain white.
  const stripe = rowIndex % 2 === 1;
  return (
    <>
      {columns.map((c) => (
        <td
          key={c.key}
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--ads-c-divider, rgba(0,0,0,0.05))',
            // Vertical column dividers, matching the header row's
            // `borderRight` so the grid lines are continuous from the
            // sticky header through every body cell.
            borderRight: '1px solid var(--ads-c-divider, rgba(0,0,0,0.08))',
            verticalAlign: c.verticalAlign ?? 'middle',
            textAlign: c.align ?? 'left',
            maxWidth: 360,
            background: stripe
              ? c.group
                ? GROUP_STYLES[c.group].stripe
                : DEFAULT_ROW_STRIPE
              : 'transparent',
          }}
        >
          {/*
           * Wrap the rendered cell content in a flex row so cell-level
           * alignment is enforced by `justifyContent` rather than
           * relying on `textAlign` to cascade through arbitrary nested
           * elements (DS components, <button>s, inline-flex wrappers).
           * That makes the alignment robust to UA button defaults and
           * to design-system components that introduce their own block
           * layout — a colored Badge or chip stays centered inside an
           * align:'center' cell instead of pinning to the left edge.
           */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                c.align === 'right'
                  ? 'flex-end'
                  : c.align === 'center'
                    ? 'center'
                    : 'flex-start',
              width: '100%',
            }}
          >
            {c.editable ? (
              <EditableCell row={row} column={c} editable={c.editable} />
            ) : (
              c.render(row)
            )}
          </div>
        </td>
      ))}
    </>
  );
}

function EditableCell<T>({
  row,
  column,
  editable,
}: {
  row: T;
  column: Column<T>;
  editable: EditableConfig<T>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(() => editable.getValue(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // When the underlying row changes (e.g. after a refresh picked up a new
  // server value), stop editing and re-sync the draft.
  useEffect(() => {
    if (!editing) setValue(editable.getValue(row));
  }, [row, editable, editing]);

  // Ref-driven focus on open avoids the `autoFocus` a11y lint warning while
  // keeping the expected "click a cell → caret is inside the input" UX.
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current ?? inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = value.trim();
    const prev = editable.getValue(row);
    if (next === prev) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await editable.onSave(row, next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setValue(editable.getValue(row));
    setEditing(false);
    setError(null);
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {editable.multiline ? (
          <textarea
            ref={textareaRef}
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (!saving) commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            style={{
              width: '100%',
              minHeight: 60,
              padding: '6px 8px',
              border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.25))',
              borderRadius: 4,
              font: 'inherit',
              lineHeight: 1.4,
              resize: 'vertical',
            }}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (!saving) commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            style={{
              width: '100%',
              padding: '4px 6px',
              border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.25))',
              borderRadius: 4,
              font: 'inherit',
            }}
          />
        )}
        {error ? (
          <span style={{ color: 'var(--color-red-500)', fontSize: 12 }}>{error}</span>
        ) : saving ? (
          <span style={{ color: 'var(--ads-c-text-secondary)', fontSize: 12 }}>
            Saving…
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      title="Click to edit"
      style={{
        display: 'inline-flex',
        alignItems: 'flex-start',
        gap: 6,
        background: hover ? 'var(--ads-c-surface-subtle, rgba(0,0,0,0.03))' : 'none',
        border: '1px dashed transparent',
        borderColor: hover ? 'var(--ads-c-divider, rgba(0,0,0,0.2))' : 'transparent',
        borderRadius: 3,
        padding: '2px 4px',
        margin: '-2px -4px',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'text',
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
      <span style={{ flex: 1, whiteSpace: 'normal', wordBreak: 'break-word' }}>
        {column.render(row)}
      </span>
      <span
        aria-hidden
        style={{
          fontSize: 11,
          opacity: hover ? 0.7 : 0,
          transition: 'opacity 120ms',
          flexShrink: 0,
        }}
      >
        ✎
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared props across plain + virtualized bodies.
// ---------------------------------------------------------------------------

type BodyProps<T> = {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T, index: number) => string;
  sort: SortState;
  onSortSet: (key: string, dir: 'asc' | 'desc' | null) => void;
  numFilters: Record<string, NumericFilter | null>;
  onNumFilterChange: (key: string, next: NumericFilter | null) => void;
  stringFilters: Record<string, string[] | null>;
  onStringFilterChange: (key: string, next: string[] | null) => void;
  textFilters: Record<string, string | null>;
  onTextFilterChange: (key: string, next: string | null) => void;
  uniqueFilterValues: Record<string, string[]>;
  blanksByColumn: Record<string, boolean>;
  widths: Record<string, number>;
  onResize: (key: string, next: number) => void;
};

/**
 * Resolve the effective width for a column. User-dragged widths (in `widths`)
 * override the column definition's own `width`. Returned in a form that both
 * `<col>` elements and `<th>` inline styles accept.
 */
function effectiveWidth<T>(
  column: Column<T>,
  widths: Record<string, number>,
): number | string | undefined {
  const override = widths[column.key];
  if (override !== undefined) return override;
  return column.width;
}

/**
 * `<colgroup>` so user-dragged widths apply to body cells too. Without it,
 * setting width on `<th>` only constrains the header and browsers may
 * redistribute body column widths. Rendered inside each body so header +
 * body stay in one `<table>` for a11y.
 */
function ColGroup<T>({
  columns,
  widths,
}: {
  columns: Column<T>[];
  widths: Record<string, number>;
}) {
  return (
    <colgroup>
      {columns.map((c) => {
        const w = effectiveWidth(c, widths);
        return (
          <col
            key={c.key}
            style={
              w !== undefined
                ? { width: typeof w === 'number' ? `${w}px` : w }
                : undefined
            }
          />
        );
      })}
    </colgroup>
  );
}

type GroupRun = {
  group: ColumnGroup | undefined;
  startKey: string;
  colSpan: number;
};

function computeGroupRuns<T>(columns: Column<T>[]): GroupRun[] {
  const runs: GroupRun[] = [];
  for (const c of columns) {
    const last = runs[runs.length - 1];
    if (last && last.group === c.group) {
      last.colSpan += 1;
    } else {
      runs.push({ group: c.group, startKey: c.key, colSpan: 1 });
    }
  }
  return runs;
}

function Header<T>({
  columns,
  sort,
  onSortSet,
  numFilters,
  onNumFilterChange,
  stringFilters,
  onStringFilterChange,
  textFilters,
  onTextFilterChange,
  uniqueFilterValues,
  blanksByColumn,
  widths,
  onResize,
}: Omit<BodyProps<T>, 'rows' | 'getRowKey'>) {
  const hasGroups = columns.some((c) => c.group !== undefined);
  const runs = hasGroups ? computeGroupRuns(columns) : null;
  return (
    <thead>
      {runs ? (
        <tr>
          {runs.map((run) => {
            const style = run.group
              ? GROUP_STYLES[run.group]
              : { label: '', bg: 'transparent', fg: 'inherit', border: 'transparent' };
            return (
              <th
                key={`group:${run.startKey}`}
                colSpan={run.colSpan}
                scope="colgroup"
                style={{
                  padding: run.group ? '6px 12px' : 0,
                  background: style.bg,
                  color: style.fg,
                  borderBottom: run.group
                    ? `2px solid ${style.border}`
                    : '1px solid transparent',
                  // Match the DS Tabs nav: 14 Lato, normal weight (the user
                  // wants tab-style typography across the table without the
                  // bold). Color (per group) plus the bottom border still
                  // distinguish banners from the column header row.
                  fontSize: 14,
                  fontWeight: 400,
                  textAlign: 'left',
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                }}
              >
                {style.label || ' '}
              </th>
            );
          })}
        </tr>
      ) : null}
      <tr>
        {columns.map((c) => (
          <HeaderCell
            key={c.key}
            column={c}
            sort={sort}
            onSortSet={onSortSet}
            numFilter={numFilters[c.key] ?? null}
            onNumFilterChange={onNumFilterChange}
            stringFilter={stringFilters[c.key] ?? null}
            onStringFilterChange={onStringFilterChange}
            textFilter={textFilters[c.key] ?? null}
            onTextFilterChange={onTextFilterChange}
            uniqueValues={uniqueFilterValues[c.key]}
            hasBlanks={blanksByColumn[c.key] ?? false}
            onResize={onResize}
            width={effectiveWidth(c, widths)}
            grouped={hasGroups}
          />
        ))}
      </tr>
    </thead>
  );
}

// ---------------------------------------------------------------------------
// Plain (non-virtualized) path.
// ---------------------------------------------------------------------------

function PlainBody<T>(props: BodyProps<T>) {
  const { rows, columns, getRowKey, widths } = props;
  return (
    <div
      style={{
        // Both axes scroll inside the wrapper; combined with `position: sticky`
        // below this anchors the table region right under the 104px fixed nav,
        // so the sticky <th> inside ends up pinned to the top of the window.
        overflow: 'auto',
        maxHeight: 'calc(100vh - 120px)',
        border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
        borderRadius: 6,
        position: 'sticky',
        top: 104,
      }}
    >
      <table
        style={{
          borderCollapse: 'collapse',
          fontSize: 14,
          // Fixed layout makes <col>/<th> widths binding instead of advisory,
          // so drag-to-resize actually shrinks/grows the column. With auto
          // layout the browser re-distributes width based on content min-size,
          // which silently undoes the resize.
          tableLayout: 'fixed',
          // `max-content` so the table is exactly the sum of its column
          // widths — combined with `min-width: 100%` it still fills the
          // container when the columns are narrower, and the parent's
          // overflow-x scrolls when they're wider. Using `width: 100%` here
          // would make the browser scale column widths down to fit, which
          // collapses small columns and overlaps headers.
          width: 'max-content',
          minWidth: '100%',
        }}
      >
        <ColGroup columns={columns} widths={widths} />
        <Header {...props} />
        <tbody>
          {rows.map((row, i) => (
            <tr key={getRowKey(row, i)}>
              <TableCells row={row} columns={columns} rowIndex={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Virtualized path (>200 rows).
// ---------------------------------------------------------------------------

function VirtualizedBody<T>(props: BodyProps<T>) {
  const { rows, columns, getRowKey, widths } = props;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  // Adaptive height: short lists collapse to fit (totalSize + sticky-header
  // band), longer lists clip at `100vh - 120px` so they scroll inside the
  // viewport. `min()` keeps the value an explicit length so `contain: strict`
  // (below) still has a definite size to bind to.
  const naturalHeight = virtualizer.getTotalSize() + VIRTUALIZED_HEADER_PX;

  return (
    <div
      ref={parentRef}
      style={{
        // `contain: strict` (below) implies `contain: size`, which tells the
        // browser to derive the box's height from layout rules alone — child
        // intrinsic size is ignored. With only `maxHeight` set, that
        // collapses the scroll container to 0 effective height, the
        // virtualizer measures clientHeight=0, and zero rows render. Pinning
        // an explicit `height` (via min()) keeps the containment bound while
        // still letting short lists size to content.
        height: `min(${naturalHeight}px, calc(100vh - 120px))`,
        overflow: 'auto',
        border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
        borderRadius: 6,
        contain: 'strict',
        position: 'sticky',
        top: 104,
      }}
    >
      <table
        style={{
          borderCollapse: 'collapse',
          fontSize: 14,
          // Fixed layout makes <col>/<th> widths binding instead of advisory,
          // so drag-to-resize actually shrinks/grows the column. With auto
          // layout the browser re-distributes width based on content min-size,
          // which silently undoes the resize.
          tableLayout: 'fixed',
          // `max-content` so the table is exactly the sum of its column
          // widths — combined with `min-width: 100%` it still fills the
          // container when the columns are narrower, and the parent's
          // overflow-x scrolls when they're wider. Using `width: 100%` here
          // would make the browser scale column widths down to fit, which
          // collapses small columns and overlaps headers.
          width: 'max-content',
          minWidth: '100%',
        }}
      >
        <ColGroup columns={columns} widths={widths} />
        <Header {...props} />
        <tbody>
          {paddingTop > 0 ? (
            <tr style={{ height: paddingTop }}>
              <td colSpan={columns.length} style={{ padding: 0, border: 0 }} />
            </tr>
          ) : null}
          {items.map((vi) => {
            const row = rows[vi.index];
            return (
              <tr
                key={getRowKey(row, vi.index)}
                data-index={vi.index}
                ref={virtualizer.measureElement}
              >
                <TableCells row={row} columns={columns} rowIndex={vi.index} />
              </tr>
            );
          })}
          {paddingBottom > 0 ? (
            <tr style={{ height: paddingBottom }}>
              <td colSpan={columns.length} style={{ padding: 0, border: 0 }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
