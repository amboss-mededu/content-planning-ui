/// <reference path="../pb_data/types.d.ts" />

// Per-source editor notes on articleSources. Free-form text the editor
// can attach to a single source row (e.g. "use only chapter 3", "flag
// for follow-up"). No backfill: empty = no notes.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleSources');
    if (!col.fields.find((f) => f.name === 'notes')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'text_notes_articleSources',
          name: 'notes',
          max: 2000,
          presentable: false,
          required: false,
          system: false,
          type: 'text',
        }),
      );
      app.save(col);
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('articleSources');
      const f = col.fields.find((x) => x.name === 'notes');
      if (f) col.fields.removeById(f.id);
      app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
