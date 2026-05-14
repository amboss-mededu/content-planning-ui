/// <reference path="../pb_data/types.d.ts" />

// Adds a `pipelineStageOverrides` JSON field to the specialties
// collection. The pipeline page uses this to flip a stage card's
// "complete" indicator on demand when the editor wants to manually
// mark a stage done (e.g. workflow was killed mid-run, or an optional
// 2nd-consolidation pass produced no output). Shape:
// `{ [stageName]: boolean }`.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pbc_2985719748');
    collection.fields.add(
      new Field({
        hidden: false,
        id: 'json_pipelineStageOverrides',
        maxSize: 0,
        name: 'pipelineStageOverrides',
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
    const field = collection.fields.find((f) => f.name === 'pipelineStageOverrides');
    if (field) collection.fields.removeById(field.id);
    return app.save(collection);
  },
);
