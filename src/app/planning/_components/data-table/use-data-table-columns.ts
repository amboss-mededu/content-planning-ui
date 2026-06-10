'use client';

import { useMemo, useState } from 'react';
import { MIN_COLUMN_WIDTH } from './constants';
import type { Column } from './types';

/** Per-column presentation state: drag-resized widths and the hidden set. */
export function useDataTableColumns<T>(columns: Column<T>[]) {
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
  // set) overrides this in the storage hook's hydrate effect.
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

  return {
    widths,
    setWidths,
    setColumnWidth,
    hidden,
    setHidden,
    visibleColumns,
    toggleHidden,
  };
}
