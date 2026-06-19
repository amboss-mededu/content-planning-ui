# PR 4 — Mapping table: inline cell editing + edit view in the detail modal

## Context

The Codes mapping table (`src/app/planning/_components/codes-view.tsx`, rendered through the
`data-table/` modules) is read-only except for Map/Remap actions. Editors want every cell to be
editable, and the row detail modal (`code-detail-modal.tsx`, 6 tabs) to gain an edit view where
they can add/remove items in the coverage and suggestions arrays.

Decisions (locked in with the user):
- **`code` stays read-only.** It is half of the composite key (`specialtySlug + code`) referenced
  by `mappingsInFlight`, `codeRunMetadata`, and the embedded `codes` arrays inside
  `consolidatedArticles` / `consolidatedSections`; renaming would silently orphan those. Fix a
  wrong code by re-importing (PR 3).
- Manually setting coverage/suggestion fields on an **unmapped** row stamps
  `mappedAt = Date.now()` — otherwise the UI's "mapped" predicates would hide the edits.

Relevant existing pieces:
- Edit endpoint exists: `PATCH /api/codes/[specialty]/[code]`
  (`src/app/api/codes/[specialty]/[code]/route.ts`) currently accepting
  `{ description, category, consolidationCategory }`, gated by `getConsolidationLockState()` →
  409 when consolidation is active.
- `patchCode(slug, code, fields)` in `src/lib/data/codes.ts:247` — queries by composite key,
  trims strings.
- Derived counts recompute helper: `deriveCodeTableCounts` in
  `src/lib/data/code-table-counts.ts`; usage pattern in `writeCodeMappingAsAdmin`
  (`codes.ts:386`).
- Coverage level enum: `COVERAGE_LEVELS` in `src/lib/types.ts:13`.
- Lock/edit plumbing already reaches the client: `canEdit`/`lockStatus` via
  `/api/codes/[specialty]/summary` → `codes-view-client.tsx:250`.
- Local row state: `codes-view-client.tsx` holds `useState<CodeTableRow[]>` (~line 37) with a 5s
  incremental poll (`updatedAfter`) for cross-tab convergence.

## Approach

### API — extend the PATCH endpoint

Replace the lenient body parsing with a strict Zod schema:

```ts
const Body = z
  .object({
    description: z.string().optional(),
    category: z.string().optional(),
    consolidationCategory: z.string().optional(),
    source: z.string().optional(),
    isInAMBOSS: z.boolean().optional(),
    coverageLevel: z.enum(COVERAGE_LEVELS).optional(),
    depthOfCoverage: z.number().min(0).optional(),
    notes: z.string().optional(),
    gaps: z.string().optional(),
    improvements: z.string().optional(),
    articlesWhereCoverageIs: z.array(CoveredSectionSchema).optional(),
    existingArticleUpdates: z.array(SectionUpdateSchema).optional(),
    newArticlesNeeded: z.array(NewArticleSchema).optional(),
  })
  .strict();
```

- Consolidation-lock gate unchanged (409, same message).
- Extend `patchCode` in `src/lib/data/codes.ts` to the wider field set. When any of the three
  arrays is present, recompute the derived counts via `deriveCodeTableCounts` and write them in
  the same update (mirror `writeCodeMappingAsAdmin`). Counts are always recomputed server-side,
  never trusted from the client.
- When coverage/suggestion fields arrive for a row whose `mappedAt` is unset, stamp
  `mappedAt = Date.now()`.
- **Return the updated row** from PATCH so the client can merge it into local table state without
  waiting for the poll.

### UI — inline scalar editing

New `src/app/planning/_components/editable-cell.tsx` exporting:
`EditableTextCell`, `EditableSelectCell`, `EditableBooleanCell`, `EditableNumberCell`.

- Render the value with a hover pencil affordance; click → DS `Input` / `Select`; Enter or blur
  saves, Esc cancels; small spinner while saving; inline error on failure.
- Stop click propagation — table rows open the detail modal via `onRowClick`.
- Column wiring in `codes-view.tsx`: editable columns are `source` (Select fed by row-distinct
  values + `codeSources` registry), `description`, `category`, `consolidationCategory` (text),
  `isInAMBOSS` (boolean), `coverageLevel` (enum Select), `depthOfCoverage` (number). `code` is
  not editable.
- Thread `canEdit: boolean` and `onPatchRow(code, fields) => Promise<CodeTableRow>` from
  `codes-view-client.tsx`, which performs the `fetch` PATCH and merges the returned row into the
  `codes` state. When the lock is active, cells render read-only (no pencil) and the server still
  enforces 409.

### UI — modal edit view (arrays)

`code-detail-modal.tsx` is ~800 lines — put the edit panels in a new
`src/app/planning/_components/code-detail-edit-panels.tsx`.

- Tabs gaining an "Edit" toggle (shown when `canEdit`): coverage-articles, suggestion-updates,
  suggestion-new-articles; plus editable textareas for notes/gaps (coverage-notes tab) and
  improvements.
- Edit mode per array: list current items with a remove button; add-item forms —
  - coverage article: article title + articleId, plus per-section entries;
  - article update: article title/id + per-section title/id/changes/importance;
  - new article: title + importance.
- Save sends the **full replacement array** via PATCH (avoids JSON merge conflicts; last-write-wins
  is acceptable for this internal tool — note it in the PR description), then re-runs the modal's
  existing detail fetch and notifies the parent so the derived count columns update.

## Data integrity

- Lock enforced server-side on every PATCH; UI affordances disabled via existing
  `canEdit`/`lockStatus` plumbing.
- Derived counts (`coverageArticleCount`, `coverageSectionCount`, `existingArticleUpdateCount`,
  `newArticleSuggestionCount`) recomputed server-side on every array write.
- Composite key lookups only; PB ids never used as identity.

## Files

| Action | Path |
|---|---|
| Create | `src/app/planning/_components/editable-cell.tsx` |
| Create | `src/app/planning/_components/code-detail-edit-panels.tsx` |
| Modify | `src/app/api/codes/[specialty]/[code]/route.ts` (strict Zod body, wider fields, return row) |
| Modify | `src/lib/data/codes.ts` (`patchCode` extension + counts recompute + mappedAt stamp) |
| Modify | `src/app/planning/_components/codes-view.tsx` (editable columns, props) |
| Modify | `src/app/planning/_components/codes-view-client.tsx` (`onPatchRow`, state merge) |
| Modify | `src/app/planning/_components/code-detail-modal.tsx` (edit toggles, panel mounting) |

## Verification

- Each scalar type edits inline, persists, and survives the 5s poll reconcile.
- Modal array edits add/remove items; the table's count columns update after save.
- With consolidation active: cells read-only, PATCH returns 409 and the error is surfaced.
- Editing coverage on an unmapped row stamps `mappedAt` and the row starts counting as mapped.
- Zod schema unit tests (accept/reject shapes, strict unknown-key rejection).
- `npm run typecheck && npm run lint && npm run test`.
