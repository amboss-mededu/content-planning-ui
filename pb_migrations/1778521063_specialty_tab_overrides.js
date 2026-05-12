/// <reference path="../pb_data/types.d.ts" />

// Adds a `tabOverrides` JSON field to the specialties collection. The
// planning sub-nav uses this to flip a tab's "step complete" indicator
// to a checkmark when auto-derived signals are unavailable (Overview)
// or fuzzy (Categories), but the editor still wants to mark the step
// done manually. Shape: `{ [tabSegment]: boolean }`.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pbc_2985719748');
    collection.fields.add(
      new Field({
        hidden: false,
        id: 'json_tabOverrides',
        maxSize: 0,
        name: 'tabOverrides',
        presentable: false,
        required: false,
        system: false,
        type: 'json',
      }),
    );
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('pbc_2985719748');
    const field = collection.fields.find((f) => f.name === 'tabOverrides');
    if (field) collection.fields.removeById(field.id);
    return app.save(collection);
  },
);
