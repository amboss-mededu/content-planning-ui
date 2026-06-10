'use client';

import { Tooltip } from '@amboss/design-system';
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react';
import { COLUMN_HEADER_STICKY_TOP_GROUPED, MIN_COLUMN_WIDTH } from './constants';
import { HeaderMenu } from './header-menu';
import type { Column, NumericFilter, SortState } from './types';

/**
 * Header cell — clicking the label opens a unified sort + filter dropdown.
 * Replaces the old "click to cycle sort" + separate ▽ filter button pattern.
 */
export function HeaderCell<T>({
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

  const startResize = (e: ReactMouseEvent | ReactPointerEvent) => {
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
