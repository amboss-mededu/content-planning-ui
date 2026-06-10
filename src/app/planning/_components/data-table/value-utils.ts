import type { Column, GroupRun, NumOp } from './types';

export function stringifyValue(
  v: string | number | boolean | Date | null | undefined,
): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function compareTyped(
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

export function compareNum(n: number, op: NumOp, v: number): boolean {
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

/**
 * Resolve the effective width for a column. User-dragged widths (in `widths`)
 * override the column definition's own `width`. Returned in a form that both
 * `<col>` elements and `<th>` inline styles accept.
 */
export function effectiveWidth<T>(
  column: Column<T>,
  widths: Record<string, number>,
): number | string | undefined {
  const override = widths[column.key];
  if (override !== undefined) return override;
  return column.width;
}

export function computeGroupRuns<T>(columns: Column<T>[]): GroupRun[] {
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
