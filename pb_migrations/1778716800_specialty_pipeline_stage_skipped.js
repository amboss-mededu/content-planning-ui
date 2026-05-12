/// <reference path="../pb_data/types.d.ts" />

// Adds a `pipelineStageSkipped` JSON field to the specialties
// collection. Editors flip this from the pipeline page when an
// optional stage (e.g. 2nd consolidation for sections) is being
// intentionally bypassed rather than completed. Distinct from
// `pipelineStageOverrides` because a skipped stage should render as
// "Skipped" rather than "Completed", though both advance the
// last-completed-step chain. Shape: `{ [stageName]: boolean }`.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pbc_2985719748');
    collection.fields.add(
      new Field({
        hidden: false,
        id: 'json_pipelineStageSkipped',
        maxSize: 0,
        name: 'pipelineStageSkipped',
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
    const field = collection.fields.find((f) => f.name === 'pipelineStageSkipped');
    if (field) collection.fields.removeById(field.id);
    return app.save(collection);
  },
);
