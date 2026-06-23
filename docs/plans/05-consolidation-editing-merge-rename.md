# PR 5 — Consolidation/backlog: merge article rows, add/remove codes, rename titles

## Context

Consolidated articles live in the `consolidatedArticles` PocketBase collection
(`src/lib/types.ts:109`): `{ id, articleKey, articleTitle, articleType, category, numCodes,
codes: Array<Record<string, unknown>> /* embedded JSON array */, previousArticleTitleSuggestions,
overallCoverage, overallImportance, justification }`. Editors want to: (a) merge multiple rows
into one, (b) add/remove codes on an article's consolidation chunk, and (c) edit the article
title.

**Key constraint — `articleKey` is content-derived from the title.**
`computeArticleKey({ specialtySlug, articleTitle, articleId, category })`
(`src/lib/data/article-keys.ts`), injected by `withArticleKey` (`src/lib/data/articles.ts:21`).
Collections that join on it (all must migrate when a key changes): `articleReviews`,
`articleBacklog`, `reviewComments`, `articleSources`, `articleLitSearchRuns` (+claims),
`articleDraftRuns` (+claims). The PB record `id` stays stable through a rename; the global
"My Backlog" view resolves rows by key (`listConsolidatedArticlesForKeys`).

Decisions (locked in with the user):
- **Merge deletes the source articles' reviews**; the target keeps its review. Source
  `reviewComments` are re-pointed to the target to preserve the audit trail.

Depends on **PR 1**'s `computeOverallCoverageFromCodes` helper
(`src/lib/data/article-coverage.ts`) — every codes mutation recomputes `overallCoverage`.

## Approach

### Data layer — new `src/lib/data/article-edits.ts` (`server-only`, admin client)

```ts
export async function setConsolidatedArticleCodesAsAdmin(
  slug: string, articleKey: string, codes: Array<Record<string, unknown>>,
): Promise<void>
// dedupe by `code` string; write codes, numCodes, and
// overallCoverage = computeOverallCoverageFromCodes(codes) (undefined → leave unset / clear)

export async function migrateArticleKeyAsAdmin(
  slug: string, oldKey: string, newKey: string,
): Promise<void>
// update `articleKey` on rows in: articleReviews, articleBacklog, reviewComments,
// articleSources, articleLitSearchRuns(+claims), articleDraftRuns(+claims)

export async function renameConsolidatedArticleByKeyAsAdmin(
  slug: string, articleKey: string, newTitle: string,
): Promise<{ newKey: string } | { conflict: true }>
// 1. load row by key; newKey = computeArticleKey({ specialtySlug: slug, articleTitle: newTitle,
//    articleId: row.articleId, category: row.category })  — same recipe as withArticleKey
// 2. if another row already owns newKey → { conflict: true } (UI suggests merging instead)
// 3. migrate joined rows FIRST (migrateArticleKeyAsAdmin), THEN update the article row in place
//    (PB id stable): articleTitle, articleKey, previousArticleTitleSuggestions += old title.
//    PB has no transactions — this order means a crash mid-way leaves the old key resolvable
//    rather than orphaning reviews.
// Note: `upd::<articleId>`-style keys don't change on title edits — then it's a title-only
// update, no migration needed.

export async function mergeConsolidatedArticlesAsAdmin(
  slug: string, targetKey: string, sourceKeys: string[],
): Promise<{ mergedCodes: number }>
// - codes: union by `code` string (same dedupe idea as the workflow's merge in
//   src/lib/workflows/consolidation/articles-secondary.ts)
// - previousArticleTitleSuggestions: union + each source articleTitle
// - justification: '\n\n' concat; overallImportance: max
// - overallCoverage: recompute from merged codes (PR 1 helper); numCodes from merged set
// - target keeps its title/category/PB id
// - delete source consolidatedArticles rows + their articleReviews (user decision)
// - reviewComments of sources: re-point articleKey to targetKey
// - backlog: keep target's row; if target has none, re-point the first source backlog row
//   (preserves assignee/status/draft URL) via articleKey update; delete remaining source rows
// - block merging two `upd::` rows with different articleIds (also blocked in UI)
```

### Server actions — `src/app/planning/[specialty]/actions.ts`

```ts
export async function renameArticle(slug, articleKey, newTitle): Promise<{ articleKey: string; error?: string }>
export async function mergeArticles(slug, targetKey, sourceKeys: string[]): Promise<{ error?: string }>
export async function updateArticleCodes(slug, articleKey, codes: EmbeddedCode[]): Promise<{ error?: string }>
export async function listCodesForArticlePicker(slug, consolidationCategory?): Promise<PickerRow[]>
```

All: `getCurrentUser()` guard, then `revalidatePath(`/planning/${slug}`, 'layout')` +
`revalidatePath('/my-backlog', 'layout')` — mirror `addManualArticle` (`actions.ts:735`).

### UI

**New `src/app/planning/_components/edit-article-modal.tsx`**
- Title `Input`; on rename show a `Callout` explaining the identity migration and that a future
  LLM consolidation re-run may regenerate the old title (pre-existing property of manual edits),
  with an explicit confirm. Conflict result → message suggesting merge instead.
- Current codes as removable chips (reuse `code-chip.tsx` / `CodeChipList` styling with an ×
  affordance).
- "Add codes" section: search `Input` + results from `listCodesForArticlePicker`,
  default-filtered to the article's consolidation bucket/category with a "show all codes" toggle.
- Save calls `renameArticle` and/or `updateArticleCodes`, then `router.refresh()`.
- Entry points: a row action in `articles-view.tsx` (alongside the existing row-click review), a
  button in `article-manager/review-manager-view.tsx`, and the backlog row menu in
  `backlog-view.tsx`.

**New `src/app/planning/_components/merge-articles-modal.tsx`**
- Select source articles (search + `Checkbox` list of the current view's rows), pick the merge
  target among the chosen set (radio/`Select`).
- Preview: merged code count, which reviews get deleted, which backlog row is kept/re-pointed.
- Confirm → `mergeArticles` → `router.refresh()`.
- Opened from a "Merge articles" toolbar `Button` in `articles-view.tsx`. During implementation,
  check whether `backlog-bulk-toolbar.tsx`'s multi-select generalizes — if so, reuse it for row
  selection instead of a modal-internal picker, and add the entry point to `backlog-view.tsx` too.

### Live updates

Reviews/backlog already stream via `useApprovalState` / `useLiveCollection`; consolidated-article
row changes arrive via `router.refresh()` after each action.

## Data integrity

- **Rename ordering**: joined-row key migration first, article row last — no transactions in PB,
  so a crash mid-rename must leave the old key intact rather than orphan reviews.
- **Re-run wipes**: consolidation re-runs wipe + re-insert `consolidatedArticles` for affected
  categories; a renamed/merged article can be regenerated under its old title by the LLM. This is
  pre-existing behavior (manual articles share it) — state it in the modal copy.
- Merge target keyed `upd::<id>` with `new::…` sources is fine (keys are opaque); never merge two
  `upd::` rows with different `articleId`s.
- Empty codes after removal → `overallCoverage` cleared (renders `—`, consistent with PR 1).

## Files

| Action | Path |
|---|---|
| Create | `src/lib/data/article-edits.ts` (+ unit tests for pure merge/rename helpers) |
| Create | `src/app/planning/_components/edit-article-modal.tsx` |
| Create | `src/app/planning/_components/merge-articles-modal.tsx` |
| Modify | `src/app/planning/[specialty]/actions.ts` (4 new actions) |
| Modify | `src/app/planning/_components/articles-view.tsx` (row action + merge toolbar button) |
| Modify | `src/app/planning/_components/article-manager/review-manager-view.tsx` (edit entry point) |
| Modify | `src/app/planning/_components/backlog-view.tsx` (row menu entry point) |
| Modify | `src/lib/data/articles.ts` (export shared code-dedupe helper if extracted) |

## Verification

- Rename: review status, assignee, comments, sources, and draft/lit-search runs survive; the
  global My Backlog still resolves the row; renaming to an existing title reports the conflict.
- Merge: codes deduped, `numCodes`/`overallCoverage` recomputed, source reviews deleted, source
  comments visible on the target, backlog assignee preserved when only a source had one.
- Add/remove codes: counts + coverage update; removing all codes renders coverage `—`.
- Re-run consolidation on an affected category → no zombie reviews or orphaned backlog rows.
- `npm run typecheck && npm run lint && npm run test`.
