import { extractCodes } from '@/app/planning/_components/code-utils';

/**
 * Average the per-code coverage scores embedded in a consolidated article's
 * `codes` JSON array into a single overall-coverage number.
 *
 * Returns `undefined` when the array is empty or carries no numeric scores —
 * the caller leaves `overallCoverage` unset so the UI renders "—" rather than
 * `0`. (PocketBase number fields default to `0`, which is why a missing value
 * must be a real `undefined` and never a written `0`.)
 *
 * Mirrors the consolidation workflow's own averaging in
 * `src/lib/workflows/consolidation/articles-secondary.ts` (round to one
 * decimal). That workflow path computes from per-record `overallCoverage`
 * values and stays untouched; this helper is for the manual/edit paths that
 * only have the embedded per-code `coverageScore`s.
 *
 * Lives outside `server-only` so unit tests and projection code can import it.
 */
export function computeOverallCoverageFromCodes(codes: unknown): number | undefined {
  const scores: number[] = [];
  for (const c of extractCodes(codes)) {
    const n =
      typeof c.coverageScore === 'number'
        ? c.coverageScore
        : typeof c.coverageScore === 'string'
          ? Number.parseFloat(c.coverageScore)
          : Number.NaN;
    if (Number.isFinite(n)) scores.push(n);
  }
  if (scores.length === 0) return undefined;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}
