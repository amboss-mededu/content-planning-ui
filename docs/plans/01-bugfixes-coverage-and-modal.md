# PR 1 — Bugfixes: manual-article coverage shows 0 + consolidation modal doesn't auto-update

## Context

Two confirmed bugs:

**Bug 1 — every manually added article shows coverage 0.**
`addManualArticle` (`src/app/planning/[specialty]/actions.ts:735`) calls
`createManualConsolidatedArticleAsAdmin` (`src/lib/data/articles.ts:320`), which creates the
`consolidatedArticles` row with only `articleTitle`/`articleType`. `overallCoverage` is never set —
and PocketBase number fields default to `0` — so the coverage column
(`articles-view.tsx:194`: `r.overallCoverage ?? r.existingAmbossCoverage ?? '—'`) renders `0`
instead of "no data". There is also no recompute of `overallCoverage` anywhere when an article's
codes change. (The consolidation workflow computes its own average at write time in
`src/lib/workflows/consolidation/articles-secondary.ts` ~line 263 — that path is correct and stays
untouched.)

**Bug 2 — the consolidation-run modal must be closed/reopened to see completion.**
`CategoryDetailsModal` (`src/app/planning/_components/category-details-modal.tsx`) fetches its
codes list once in a `useEffect` keyed on `[slug, bucket.consolidationCategory]` (lines 146–160).
The bucket counts/status **do** refresh after a rerun settles — `consolidation-buckets-view.tsx`
stores `openCategory: string` and re-derives the bucket object from fresh server rows after
`useRerunningCategories`' `onSettled` → `router.refresh()` — but the codes list never refetches
while the modal stays open, so the modal looks stale until reopened.

## Approach

### Bug 1

1. **New helper** `src/lib/data/article-coverage.ts` (plain module, unit-testable, no
   `server-only` so tests can import it):
   ```ts
   export function computeOverallCoverageFromCodes(codes: unknown): number | undefined
   ```
   - Reuse `extractCodes` from `src/app/planning/_components/code-utils.ts` (deliberately a
     non-client module per its own header comment) to normalize the embedded codes array.
   - Average the numeric coverage scores of the codes; return `undefined` when the array is empty
     or carries no numeric scores.
   - Add `src/lib/data/article-coverage.test.ts` covering: empty array, codes without scores,
     mixed scored/unscored, normal average.

2. **Write side** — `createManualConsolidatedArticleAsAdmin` (`src/lib/data/articles.ts:320`):
   include `codes: []` and `numCodes: 0` in the created row; do **not** write `overallCoverage`
   (leave unset).

3. **Projection side** — where `ConsolidatedArticle` rows are projected to `ArticleRow` for the
   articles/backlog tables (articles page loader): normalize
   `overallCoverage === 0 && (codes ?? []).length === 0` → `undefined`, so existing legacy rows
   (already created with the bug) render `—` instead of `0`.

4. **Future-proofing**: export the helper — PR 5 (consolidation editing) calls it on every codes
   mutation so coverage stays consistent.

### Bug 2

In `category-details-modal.tsx`:
- Extract the `listBucketCodes(slug, bucket.consolidationCategory)` fetch into a reusable
  callback.
- Watch the `isRerunning` prop for a `true → false` transition (previous value in a ref; when it
  flips to false, bump a `refreshSeq` state included in the fetch effect's deps — or call the
  fetch callback directly).
- Reuse the existing loading spinner while refetching (set `codes` to `null` first).
- No changes needed in `consolidation-buckets-view.tsx` — the bucket prop already refreshes via
  `router.refresh()` on settle.

## Files

| Action | Path |
|---|---|
| Create | `src/lib/data/article-coverage.ts` |
| Create | `src/lib/data/article-coverage.test.ts` |
| Modify | `src/lib/data/articles.ts` (`createManualConsolidatedArticleAsAdmin`) |
| Modify | articles page projection (`ConsolidatedArticle → ArticleRow`) |
| Modify | `src/app/planning/_components/category-details-modal.tsx` |

## Verification

- `npm run typecheck && npm run lint && npm run test`
- Manual: add an article via the backlog "+ Add article" modal (`add-article-modal.tsx`) → the
  coverage column shows `—`, not `0`.
- Manual: open a category details modal from the Consolidation buckets tab, trigger a rerun, wait
  for it to settle **without closing the modal** → status badge, counts, and the codes list all
  update in place.
- Pre-existing manual articles (coverage stored as 0, no codes) render `—` after the projection
  fix.
