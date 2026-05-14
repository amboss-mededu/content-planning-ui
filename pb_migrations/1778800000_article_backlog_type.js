/// <reference path="../pb_data/types.d.ts" />

// Adds a `type` field to articleBacklog distinguishing new-article rows
// from article-update rows. Defaults to 'new' for back-compat: existing
// rows are all new-article approvals (the only flow that created backlog
// rows before this migration). Article-update rows are created server-
// side when a section review is approved — see submitSectionReview.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('articleBacklog');
    collection.fields.add(
      new Field({
        type: 'select',
        name: 'type',
        required: false,
        maxSelect: 1,
        values: ['new', 'update'],
      }),
    );
    app.save(collection);

    // Backfill existing rows so they explicitly carry type='new'. We
    // could rely on read-time defaulting, but stamping the value lets
    // PB filters like `type = "update"` work without LEFT-JOIN-style
    // null handling at every query site.
    const rows = app.findAllRecords('articleBacklog');
    for (const r of rows) {
      if (!r.get('type')) {
        r.set('type', 'new');
        app.save(r);
      }
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('articleBacklog');
    const field = collection.fields.find((f) => f.name === 'type');
    if (field) collection.fields.removeById(field.id);
    return app.save(collection);
  },
);
