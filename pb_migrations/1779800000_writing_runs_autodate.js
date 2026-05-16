/// <reference path="../pb_data/types.d.ts" />

// Add `created` / `updated` autodate fields to articleWritingRuns.
//
// PB 0.37 does not auto-add these system columns to base collections —
// they have to be declared as autodate fields. The dispatcher's queue
// query sorts by `created` (FIFO), which 400s on a collection that
// lacks the column. Backfilling on existing rows uses the current
// timestamp; the queue is empty in practice so the seed value
// doesn't matter.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleWritingRuns');
    let dirty = false;
    if (!col.fields.find((f) => f.name === 'created')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'autodate_created_writingRuns',
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
          id: 'autodate_updated_writingRuns',
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
      const col = app.findCollectionByNameOrId('articleWritingRuns');
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
