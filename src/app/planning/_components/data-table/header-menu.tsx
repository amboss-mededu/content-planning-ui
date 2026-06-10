'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BLANKS_FILTER_VALUE } from './constants';
import { CategoricalFilter, ContainsFilter } from './filter-inputs';
import { MenuDivider, MenuItem, MenuSectionLabel } from './menu-primitives';
import type { Column, NumericFilter, NumOp } from './types';

/**
 * Header dropdown — sort + filter actions for a single column. Portals to
 * document.body so it sits above the sticky banner (z=2) and any other DS
 * surfaces. Anchored to the header button via a getBoundingClientRect coord
 * recompute on resize / ancestor scroll.
 */
export function HeaderMenu<T>({
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
  anchorRef: RefObject<HTMLButtonElement | null>;
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
