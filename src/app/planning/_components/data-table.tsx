'use client';

import { Button, Text } from '@amboss/design-system';
import { type CSSProperties, type ReactNode, useEffect } from 'react';
import { PlainBody, VirtualizedBody } from './data-table/body';
import { ColumnsMenu } from './data-table/columns-menu';
import { VIRTUALIZE_THRESHOLD } from './data-table/constants';
import type { Column } from './data-table/types';
import { useDataTableColumns } from './data-table/use-data-table-columns';
import { useDataTableFilters } from './data-table/use-data-table-filters';
import { useDataTableSort } from './data-table/use-data-table-sort';
import { useDataTableStorage } from './data-table/use-data-table-storage';

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
  const {
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
  } = useDataTableFilters(rows, columns);
  const {
    widths,
    setWidths,
    setColumnWidth,
    hidden,
    setHidden,
    visibleColumns,
    toggleHidden,
  } = useDataTableColumns(columns);
  const { sort, setSort, sortedRows, onSortSet } = useDataTableSort(
    filteredRows,
    columns,
  );
  // Called after the state hooks above so the hydrate effect restores into
  // them; see the hook's docblock for the persist-race it guards against.
  useDataTableStorage({
    storageKey,
    sort,
    setSort,
    numFilters,
    setNumFilters,
    stringFilters,
    setStringFilters,
    textFilters,
    setTextFilters,
    hidden,
    setHidden,
    widths,
    setWidths,
  });

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
