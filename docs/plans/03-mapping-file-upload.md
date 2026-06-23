# PR 3 — Mapping table: upload a codes file (XLSX + CSV → upsert into `codes`)

## Context

Mapping rows live in the `codes` PocketBase collection, keyed by the composite
`specialtySlug + code`. Today codes only enter via CLI seed scripts. Editors want to upload a file
with the mapping metadata columns — **source, code, description, category, consolidation
category** — directly from the Mapping view. New source values must surface in the UI (the
table's source filter derives its options dynamically from row values in
`src/app/planning/_components/data-table/use-data-table-filters.ts`, so they appear
automatically) and be registered so the user can select them elsewhere.

Decisions (locked in with the user):
- **Formats: XLSX and CSV.**
- **Merge/upsert only** — no delete/replace mode. The preview step must show an explicit
  **warning that matching existing rows will be overwritten** (their metadata columns).

Relevant existing pieces:
- `exceljs@^4.4.0` and `zod` are runtime dependencies — server routes can parse XLSX without new
  packages. No CSV library exists; write a small in-repo RFC-4180 parser.
- `scripts/_lib/xlsx.ts` is CLI-oriented (imports `node:fs`, `@/env`) — do **not** import it into
  the app; lift only its cell-normalization patterns (`cleanCell`-style trimming).
- Upsert pattern reference: `scripts/import-board-mapping.ts`.
- Edit gating: `getConsolidationLockState(slug)` (`src/lib/data/pipeline.ts:396`) → respond 409
  with the same wording as `PATCH /api/codes/[specialty]/[code]` ("Consolidation is active — reset
  the consolidation stage to edit codes.").
- Source registry: `codeSources` collection, `createCodeSource(slug, name)` in
  `src/lib/data/code-sources.ts:38` (idempotent upsert).
- The codes table converges automatically: `codes-view-client.tsx` polls incrementally every 5s
  using an `updatedAfter` filter, so created/updated rows appear without manual reload.

## Approach

### Parsing module — `src/lib/import/code-import.ts` (`server-only`)

```ts
export type ParsedCodeRow = {
  source: string;
  code: string;
  description?: string;
  category?: string;
  consolidationCategory?: string;
};

export async function parseCodeImportFile(
  buf: ArrayBuffer,
  filename: string,
): Promise<{ rows: ParsedCodeRow[]; errors: Array<{ line: number; message: string }> }>
```

- Header matching is case/whitespace-insensitive with aliases: `consolidation category` /
  `consolidationCategory` / `consolidation_category`, etc. Missing required headers → a single
  helpful error naming what was expected.
- XLSX: ExcelJS `workbook.xlsx.load(arrayBuffer)`, first worksheet (or the only one).
- CSV: in-repo RFC-4180 parser (quoted fields, escaped quotes, CRLF) with unit tests.
- Per-row Zod schema: `code` required non-empty; all other fields optional trimmed strings; blank
  → undefined.
- Report duplicate `code` values within the file (last-one-wins at commit; surfaced in preview).

### API route — `POST /api/codes/[specialty]/import` (multipart)

Fields: `file`, `mode: 'preview' | 'commit'`, `sources` (JSON array of source values to include —
commit only).

Guards (both modes): `requireUserResponse()`; consolidation lock → 409; file-size cap (~20 MB);
parse errors returned structured, not thrown.

- **Preview response**:
  ```ts
  {
    totalRows: number;
    validRows: number;
    errors: Array<{ line: number; message: string }>;
    duplicateCodesInFile: string[];
    overwriteCount: number;            // existing codes whose metadata will be overwritten
    sources: Array<{
      value: string;
      rowCount: number;
      existsInRegistry: boolean;
      createCount: number;             // new codes
      updateCount: number;             // existing codes that will be overwritten
    }>;
  }
  ```
  Computed by diffing parsed rows against one `getFullList` of the specialty's existing codes
  keyed by `code`.
- **Commit response**: `{ created, updated, skippedSources, newSourcesRegistered }`.

### Data helper — `upsertCodesAsAdmin` in `src/lib/data/codes.ts`

```ts
export async function upsertCodesAsAdmin(
  slug: string,
  rows: ParsedCodeRow[],
): Promise<{ created: number; updated: number }>
```

- One `getFullList` keyed by `code`.
- Matches: `update` **only** `{ source, description, category, consolidationCategory }` — never
  touch `mappedAt`, coverage fields, suggestion arrays, or derived counts. Mapping results are
  preserved; only metadata is overwritten (this is what the preview warning describes).
- New rows: reuse the `bulkInsertCodesAsAdmin` defaults (zero counts, `mappedAt` unset → unmapped
  sentinel; see the comment near `codes.ts:464`).
- For each user-selected source value not in `codeSources`, call
  `createCodeSource(slugify(value), value)`.

### UI — `src/app/planning/_components/import-codes-modal.tsx`

Launched from an "Import codes" `Button` in `mapping-view.tsx` next to the existing header
controls; disabled with a `Tooltip` when the consolidation lock is active (lock state already
flows through `/api/codes/[specialty]/summary` → `codes-view-client.tsx:250`).

- **Step 1**: file picker (`accept=".xlsx,.csv"`) → POST `mode=preview`.
- **Step 2** (preview):
  - `Callout type="error"` listing row errors (capped at ~20, with "+N more").
  - **`Callout type="warning"`: "N existing codes will have their source / description / category /
    consolidation category overwritten by this file."** (required by user decision).
  - Per-source rows with `Checkbox` (which sources to import), `Badge text="new source"` for
    unregistered ones, create/update counts per source.
  - Commit `Button` (disabled when nothing selected or all rows invalid).
- **Step 3**: result summary (`created / updated / new sources registered`); on close →
  `router.refresh()`. The 5s incremental poll picks up changes too.

## Data integrity

- Upsert only — no deletions ever; bulk deletion stays with the wipe scripts.
- Consolidation lock enforced server-side on both preview and commit.
- Composite key `specialtySlug + code` respected; PB record ids never used as identity.
- New source values appear in the table's source filter automatically (derived from row values).

## Files

| Action | Path |
|---|---|
| Create | `src/lib/import/code-import.ts` |
| Create | `src/lib/import/code-import.test.ts` |
| Create | `src/app/api/codes/[specialty]/import/route.ts` |
| Create | `src/app/planning/_components/import-codes-modal.tsx` |
| Modify | `src/lib/data/codes.ts` (`upsertCodesAsAdmin`) |
| Modify | `src/app/planning/_components/mapping-view.tsx` (button + modal wiring) |

## Verification

- Parser unit tests: header aliasing, quoted CSV fields, in-file duplicate codes, missing headers,
  XLSX and CSV parity.
- Manual: upload a file → preview shows totals, row errors, new-source badges, and the overwrite
  warning with the correct count; commit creates new + updates existing rows; mapping results
  (`mappedAt`, coverage, suggestions) on updated rows are untouched.
- With consolidation active: button disabled, route returns 409.
- A mapping workflow run on freshly imported codes works (rows are unmapped).
- `npm run typecheck && npm run lint && npm run test`.
