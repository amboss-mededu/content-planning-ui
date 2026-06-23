import type { CSSProperties } from 'react';
import type { ColumnGroup } from './types';

export const GROUP_STYLES: Record<
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
    label: 'AMBOSS coverage',
    bg: 'rgb(228, 241, 234)',
    fg: 'rgb(15, 95, 50)',
    border: 'rgb(34, 139, 80)',
    stripe: 'rgba(34, 139, 80, 0.06)',
  },
  guideline: {
    label: 'Guideline coverage',
    bg: 'rgb(224, 238, 246)',
    fg: 'rgb(20, 80, 110)',
    border: 'rgb(56, 132, 168)',
    stripe: 'rgba(56, 132, 168, 0.06)',
  },
  overall: {
    label: 'Overall',
    bg: 'rgb(238, 232, 247)',
    fg: 'rgb(80, 50, 130)',
    border: 'rgb(124, 92, 184)',
    stripe: 'rgba(124, 92, 184, 0.06)',
  },
  literature: {
    label: 'Literature',
    bg: 'rgb(238, 232, 247)',
    fg: 'rgb(91, 33, 182)',
    border: 'rgb(124, 58, 237)',
    stripe: 'rgba(124, 58, 237, 0.06)',
  },
  consolidation: {
    label: 'Consolidation',
    bg: 'rgb(231, 235, 247)',
    fg: 'rgb(40, 60, 130)',
    border: 'rgb(79, 102, 184)',
    stripe: 'rgba(79, 102, 184, 0.06)',
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
export const DEFAULT_ROW_STRIPE = 'rgba(15, 23, 42, 0.035)';

// Always virtualize: only the rows in (and slightly around) the visible
// viewport are rendered, so initial paint cost stays roughly constant
// regardless of total row count. With the adaptive height in `VirtualizedBody`,
// short lists collapse to their natural size instead of locking to the
// viewport — so virtualization is safe everywhere and there's no need for a
// "small enough to render plain" carve-out.
export const VIRTUALIZE_THRESHOLD = 0;

// Sentinel value used in the categorical filter to represent "rows whose
// filter value is empty/undefined". Stored in `stringFilters` like any other
// value, but special-cased in the per-row match loop so blanks become a
// first-class selectable option in select-style filters. Picked as a string
// that no real `filterValue` would produce so there's no risk of collision.
export const BLANKS_FILTER_VALUE = '__amboss_blanks__';

// Approximate vertical space taken by the sticky header band (group banner +
// column header row + a small buffer). Used to compute the virtualized
// container's natural height so tables shorter than the viewport collapse
// to fit instead of being pinned to `100vh - 120px`.
export const VIRTUALIZED_HEADER_PX = 80;

export const MIN_COLUMN_WIDTH = 50;

/** Sticky `top` (px) for the column-header row when group banners are
 *  present. Deliberately a few px LESS than the banner's intrinsic height
 *  (~32px at 14px Lato + 6/12 padding + ~1.4 line-height) so the
 *  column-header row overlaps the banner's bottom edge. Banner has z-index
 *  2 and covers the overlap zone, so the eye sees them flush — no gap,
 *  regardless of how the browser sizes the banner. The overlapped pixels
 *  of the column header are inside its 10px top padding, not its content. */
export const COLUMN_HEADER_STICKY_TOP_GROUPED = 28;

export const miniButtonStyle: CSSProperties = {
  background: 'none',
  border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 12,
  cursor: 'pointer',
  font: 'inherit',
};
