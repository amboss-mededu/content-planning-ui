import type { CodeRecord } from '@/lib/pb/types';

export type CodeCategorySummary = {
  category: string;
  total: number;
  unmapped: number;
  mapped: number;
  /** True when every code in this category has a `mappedAt` stamp — the
   *  signal the consolidation step will consume in the follow-up branch to
   *  enable a per-category "Start consolidation" trigger. */
  readyForConsolidation: boolean;
};

export function deriveCodeCategories(rows: CodeRecord[]): CodeCategorySummary[] {
  const totals = new Map<string, { total: number; unmapped: number }>();
  for (const r of rows) {
    const cat = r.category ?? '(uncategorized)';
    const entry = totals.get(cat) ?? { total: 0, unmapped: 0 };
    entry.total += 1;
    if (!r.mappedAt) entry.unmapped += 1;
    totals.set(cat, entry);
  }
  return Array.from(totals.entries())
    .map(([category, t]) => {
      const mapped = t.total - t.unmapped;
      return {
        category,
        total: t.total,
        unmapped: t.unmapped,
        mapped,
        readyForConsolidation: t.total > 0 && t.unmapped === 0,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}
