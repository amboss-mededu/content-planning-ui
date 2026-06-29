/**
 * Parsing helpers for the pipe-separated curriculum `category` string.
 *
 * Curriculum extraction stores the full hierarchy in `category`, pipe-separated
 * broadest→narrowest — e.g. `"Bloque 1 | 1.1 Introducción"`. These helpers split
 * that into the top-level block (used to group the Timeline and Gap reports) and
 * the remainder. Pure module — no PB/server deps — so it is unit-testable in
 * isolation, mirroring `curriculum-meta.ts`.
 */

/** Shown when a code has no usable category. Matches `curriculum-structure.tsx`. */
export const UNCATEGORIZED = 'Uncategorized';

export interface ParsedCategory {
  /** The broadest hierarchy node — the segment before the first `|`. */
  block: string;
  /** Everything after the first `|`, re-joined with " | " (segments trimmed,
   *  empties dropped). Empty when there is no further hierarchy. */
  rest: string;
}

/**
 * Split a pipe-separated curriculum category into its top block and the rest.
 * Splits on the FIRST `|` only, so deeper hierarchy stays intact in `rest`.
 * Empty / whitespace / undefined / null → `{ block: UNCATEGORIZED, rest: '' }`.
 */
export function parsePipeCategory(category?: string | null): ParsedCategory {
  const trimmed = category?.trim();
  if (!trimmed) return { block: UNCATEGORIZED, rest: '' };
  const idx = trimmed.indexOf('|');
  if (idx === -1) return { block: trimmed, rest: '' };
  const block = trimmed.slice(0, idx).trim();
  const rest = trimmed
    .slice(idx + 1)
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' | ');
  return { block: block || UNCATEGORIZED, rest };
}

/** The top-level block of a curriculum category (the segment before the first `|`). */
export function topBlockOf(category?: string | null): string {
  return parsePipeCategory(category).block;
}
