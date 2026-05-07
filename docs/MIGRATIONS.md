# Schema migrations

PocketBase is the source of truth. Schema changes ship as JS migration files
in [`pb_migrations/`](../pb_migrations), loaded automatically by
`pocketbase serve` on startup. There are no production users yet, and the
editor data is fully reproducible from xlsx fixtures + the `extract` /
`map` / `consolidate` pipelines, so the standard playbook for an
incompatible change is **wipe + reseed** rather than an in-place data
migration.

## Two paths

1. **Schema migration** — additive or rule-only changes (new collection,
   new field, tightened access rule, new index). Write a new file in
   `pb_migrations/` and let the next `pocketbase serve` apply it.
2. **Wipe + reseed** — destructive changes (renamed field, changed type,
   changed nesting shape) where existing rows would violate the new shape.
   Write the schema migration anyway, but plan to drop and reseed the
   affected collections.

## When to write a migration file

- New collection.
- New field on an existing collection.
- Changed access rule (`listRule` / `viewRule` / `createRule` /
  `updateRule` / `deleteRule`) or schema constraint.
- New index.
- Renamed field (do an additive rename: add new, dual-write, backfill,
  drop old — only if there's data to preserve; otherwise just wipe +
  reseed).

## Authoring a migration

1. Pick a millisecond timestamp prefix that comes *after* the latest
   existing file (the directory sorts lexically). Filename pattern:
   `<unix_seconds>_<short_description>.js` — e.g.
   `1778122500_ontology_rich_schema.js`.

2. Use the same skeleton as existing migrations:

   ```js
   /// <reference path="../pb_data/types.d.ts" />

   migrate(
     (app) => {
       // forward: apply the change
       const col = app.findCollectionByNameOrId('codes');
       col.fields.add(new Field({ type: 'text', name: 'newField', max: 200 }));
       app.save(col);
     },
     (app) => {
       // backward: undo the change (best-effort)
       const col = app.findCollectionByNameOrId('codes');
       const f = col.fields.getByName('newField');
       if (f) col.fields.remove(f.id);
       app.save(col);
     },
   );
   ```

   PocketBase records each applied migration in the `_migrations` system
   collection. Don't rename or edit a migration after it's been applied
   anywhere — write a follow-up migration instead.

3. Update reads + writes that reference the field:
   - `src/lib/pb/types.ts` (the typed record)
   - `src/lib/data/<domain>.ts` (reads / writes)
   - `src/lib/workflows/lib/db-writes.ts` (pipeline-side writes)
   - any UI consuming the old shape

4. Local apply: just restart the PB binary.

   ```sh
   ./bin/pocketbase serve
   ```

   PB applies pending migrations on startup. Check logs for
   `Successfully migrated <file>`.

5. If existing rows in dev violate a new constraint, PB will refuse to
   start. Two options:
   - **Wipe the affected collections and reseed** (preferred for ergonomic
     fixture data). See below.
   - Run `pocketbase migrate down` and reauthor the migration to be
     additive (add the new field alongside the old, dual-write, backfill).

## Wipe + reseed (the destructive path)

When a change makes existing rows invalid and there's no production data
to preserve, drop the collection content and reseed from xlsx fixtures.

1. Apply your migration (it'll empty rows that violate constraints, or
   leave them in a quarantined state — depends on the change).

2. Reseed editor data:

   ```sh
   npm run seed:local                                  # editor tables + ontology
   npm run import-board                                # specialty registry
   npm run import-milestones -- <slug> <file.txt>      # milestones for a specialty
   ```

   `seed-pocketbase.ts` deletes rows per collection then bulk-inserts. The
   seed script normalises whatever the xlsx fixture happens to hold into
   the current schema (see normalisation helpers in `scripts/_lib/`). When
   you change a field shape and the fixture data trips it, **extend the
   normaliser rather than mutating the xlsx**.

3. Pipeline tables (`pipelineRuns`, `pipelineStages`, `pipelineEvents`,
   `pipelineUploads`) are not in the seed. Wipe via the PB admin UI at
   `:8090/_/` or by running `npm run wf:extract`-style flows that recreate
   them.

## What we explicitly don't do

- **No backwards-compat shims.** Don't dual-read both shapes; don't add a
  fallback path that parses the old encoding. Pick a cutover and ship it.
- **No standalone migration scripts.** A reseed is the migration. If a
  one-off data edit is needed, run it from the PB admin UI or with
  `pocketbase migrate <name>` — don't commit a script that nobody will
  use again.
- **No xlsx fixture edits to dodge a constraint.** The xlsx is the source
  of truth for fixture content; the seed normaliser bridges the gap to
  the current schema.

## Production note

There are no production users today. When that changes, this doc will
get a "real migration" section: dual-write windows, backfill scripts,
and a checklist for irreversible deploys.
