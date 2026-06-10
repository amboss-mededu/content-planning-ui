'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { TableCells } from './cells';
import { GROUP_STYLES, VIRTUALIZED_HEADER_PX } from './constants';
import { HeaderCell } from './header-cell';
import type { BodyProps, Column } from './types';
import { computeGroupRuns, effectiveWidth } from './value-utils';

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
                {style.label || ' '}
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

export function PlainBody<T>(props: BodyProps<T>) {
  const { rows, columns, getRowKey, widths } = props;
  return (
    // Outer: `position: sticky` only — pins the table region right under
    // the 104px fixed nav as the page scrolls. NO overflow here.
    // Inner: takes the scroll role with `overflow: auto`. Splitting the
    // two responsibilities is intentional — combining sticky + overflow
    // on one element produced layout glitches in some browsers (first
    // column clipped, no horizontal scrollbar).
    <div style={{ position: 'sticky', top: 104, width: '100%' }}>
      <div
        style={{
          overflow: 'auto',
          maxHeight: 'calc(100vh - 120px)',
          border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
          borderRadius: 6,
          width: '100%',
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
            {rows.map((row, i) => {
              const style = props.getRowStyle?.(row, i);
              const rowStyle = props.onRowClick
                ? { ...(style ?? {}), cursor: 'pointer' as const }
                : style;
              return (
                <tr
                  key={getRowKey(row, i)}
                  style={rowStyle}
                  onClick={
                    props.onRowClick ? () => props.onRowClick?.(row, i) : undefined
                  }
                >
                  <TableCells row={row} columns={columns} rowIndex={i} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Virtualized path (>200 rows).
// ---------------------------------------------------------------------------

export function VirtualizedBody<T>(props: BodyProps<T>) {
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
    // Outer: `position: sticky` only — pins the table region under the
    // 104px fixed nav as the page scrolls. NO overflow / contain here.
    // Inner: takes the scroll role + `contain: strict` for the
    // virtualizer's height measurement. Splitting the responsibilities
    // is intentional — combining sticky + overflow + contain on one
    // element produced layout glitches where the first column clipped
    // and the horizontal scrollbar didn't appear.
    <div style={{ position: 'sticky', top: 104, width: '100%' }}>
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
          width: '100%',
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
              const style = props.getRowStyle?.(row, vi.index);
              const rowStyle = props.onRowClick
                ? { ...(style ?? {}), cursor: 'pointer' as const }
                : style;
              return (
                <tr
                  key={getRowKey(row, vi.index)}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={rowStyle}
                  onClick={
                    props.onRowClick ? () => props.onRowClick?.(row, vi.index) : undefined
                  }
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
    </div>
  );
}
