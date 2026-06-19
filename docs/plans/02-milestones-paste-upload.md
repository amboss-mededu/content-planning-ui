# PR 2 — Milestones tab: paste text directly + upload a .txt file

## Context

Milestones are stored as a plain-text blob on `specialties.milestones` (PocketBase `specialties`
collection). Today the only ways to populate it are the LLM extraction workflow
(`/api/workflows/extract-milestones`) and the CLI script `scripts/import-milestones.ts`. Editors
want to paste milestones directly into the Milestones tab or upload a `.txt` file.

Relevant existing pieces:
- Display: `src/app/planning/_components/milestones-view.tsx` — client component, read-only;
  parses JSON milestone output into a competency tree, falls back to `<pre>` for plain text.
- Write helper: `updateMilestonesAsAdmin({ slug, milestones, bumpSeedTimestamp })` in
  `src/lib/data/specialties.ts`.
- `MilestonesView` already receives the extraction-running state as a prop.
- `/api/uploads` (`src/app/api/uploads/route.ts`) is PDF-only and stores files in PB — **wrong
  tool here**; a `.txt` upload should never hit the server as a file.

## Approach

Client-side file reading + one server action. No new API route, no PB file storage.

1. **Server action** in `src/app/planning/[specialty]/actions.ts`:
   ```ts
   export async function saveMilestones(slug: string, text: string): Promise<{ error?: string }>
   ```
   - `getCurrentUser()` guard (same pattern as `addManualArticle`).
   - Trim; reject empty and > 2 MB with a friendly error.
   - Call existing `updateMilestonesAsAdmin({ slug, milestones: text })`. Do **not** pass
     `bumpSeedTimestamp` — that timestamp is a seed-lineage signal, not an edit marker.
   - `revalidatePath(`/planning/${slug}`, 'layout')`.
   - Note: Next server actions default to a 1 MB body limit. If milestone blobs can exceed that,
     set `serverActions: { bodySizeLimit: '4mb' }` in `next.config.ts`.

2. **UI** — new client component `src/app/planning/_components/milestones-editor.tsx`, rendered
   from `milestones-view.tsx`:
   - An "Edit milestones" `Button` (tertiary) next to the existing milestones `Card` (remember:
     `Card` must always get `outlined` in this app). When no milestones exist yet, render the
     editor entry point beneath the existing empty-state `Callout` + `StartMilestonesModal`
     trigger.
   - Editor body: `Card outlined` → `Stack` with:
     - DS `Textarea` holding the milestone text (prefilled with current value when editing).
     - A native `<input type="file" accept=".txt,text/plain">` labeled "Load from .txt file" —
       reads via `FileReader.readAsText` and **populates the textarea only** (no auto-save), so
       the user can review before committing.
     - `Callout type="warning"` shown when existing content would be overwritten.
     - Save / Cancel `Button`s. Save → `saveMilestones` → on success `router.refresh()` and close
       the editor; surface `error` inline otherwise.
   - Disable the editor (with a hint) while the extraction workflow is running — the workflow
     writes the same field; the running state is already a prop on `MilestonesView`.
   - The existing JSON-tree rendering (`tryParse`/tree extraction in `milestones-view.tsx`) stays
     untouched and previews whatever was saved.

## Data integrity

- Plain blob overwrite — acceptable; the warning callout makes it explicit.
- Race with the extraction workflow is prevented UI-side (editor disabled while running); the
  workflow's approval step remains the only other writer.

## Files

| Action | Path |
|---|---|
| Create | `src/app/planning/_components/milestones-editor.tsx` |
| Modify | `src/app/planning/_components/milestones-view.tsx` |
| Modify | `src/app/planning/[specialty]/actions.ts` (`saveMilestones`) |
| Maybe | `next.config.ts` (`serverActions.bodySizeLimit`) |

## Verification

- Paste text → Save → page refresh shows the parsed tree (JSON input) or raw text (plain input).
- Upload a `.txt` file → textarea fills, nothing saved until Save is clicked.
- Editor is disabled while a milestone extraction run is active.
- CLI path still works: `npm run import-milestones -- <slug> <file>`.
- `npm run typecheck && npm run lint && npm run test`.
