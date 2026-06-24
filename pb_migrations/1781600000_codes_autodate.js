/// <reference path="../pb_data/types.d.ts" />

// Add `created` / `updated` autodate fields to the `codes` collection.
//
// PB 0.37 does not auto-add these system columns to base collections — they
// have to be declared as autodate fields (same fix as
// 1779800000_writing_runs_autodate). The codes/mapping sheet's live-update
// loop is built entirely around `codes.updated`:
//   - listCodeTableRowsPage sorts by `updated` and filters `updated > {after}`
//     for the client's incremental poll (src/lib/data/codes.ts)
//   - codes-view-client seeds its poll cursor from each row's `updated` and
//     gates row replacement on a changed `updated`.
// Without the column that filter 400s and `updated` is always undefined, so the
// table never refreshes while a map/remap runs — you have to reload the page.
//
// Backfilling existing rows uses the current timestamp; the exact seed value
// doesn't matter because every subsequent write stamps `updated` via onUpdate.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('codes');
    let dirty = false;
    if (!col.fields.find((f) => f.name === 'created')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'autodate_created_codes',
          name: 'created',
          onCreate: true,
          onUpdate: false,
          presentable: false,
          system: false,
          type: 'autodate',
        }),
      );
      dirty = true;
    }
    if (!col.fields.find((f) => f.name === 'updated')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'autodate_updated_codes',
          name: 'updated',
          onCreate: true,
          onUpdate: true,
          presentable: false,
          system: false,
          type: 'autodate',
        }),
      );
      dirty = true;
    }
    if (dirty) app.save(col);
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('codes');
      for (const name of ['created', 'updated']) {
        const f = col.fields.find((x) => x.name === name);
        if (f) col.fields.removeById(f.id);
      }
      app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
