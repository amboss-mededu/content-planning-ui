import type { CSSProperties, ReactNode } from 'react';

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
 *               on hover; click swaps to an editor (Enter to save,
 *               Escape/blur to cancel). Save errors render inline below.
 *               `kind` picks the editor: text (default), number, or a native
 *               select (`select`/`boolean`) that commits on change. Values
 *               are always carried as strings — the column's `onSave` parses.
 */
export interface EditableConfig<T> {
  getValue: (row: T) => string;
  onSave: (row: T, next: string) => Promise<void>;
  multiline?: boolean;
  kind?: 'text' | 'number' | 'select' | 'boolean';
  /** Option list for `kind: 'select' | 'boolean'`. The empty-string value is
   *  rendered as a "clear" choice when present. */
  options?: Array<{ value: string; label: string }>;
}

export type ColumnGroup =
  | 'metadata'
  | 'coverage'
  | 'guideline'
  | 'overall'
  | 'consolidation'
  | 'suggestions'
  | 'actions';

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
  /** Start the column hidden. The user can re-enable it from the Columns
   *  menu. Use for columns that exist for completeness but aren't useful
   *  at the current aggregation level (e.g. per-section fields shown on
   *  a per-article row). Persisted state still wins over this default. */
  defaultHidden?: boolean;
}

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export type NumOp = '>' | '>=' | '<' | '<=' | '=' | '!=';
export type NumericFilter = { op: NumOp; value: number };

/** Shared props across plain + virtualized bodies. */
export type BodyProps<T> = {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T, index: number) => string;
  getRowStyle?: (row: T, index: number) => CSSProperties | undefined;
  onRowClick?: (row: T, index: number) => void;
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

export type GroupRun = {
  group: ColumnGroup | undefined;
  startKey: string;
  colSpan: number;
};
