/// <reference path="../pb_data/types.d.ts" />

// Adds editor-controlled pipeline card states to specialties. Legacy
// pipelineStageOverrides / pipelineStageSkipped remain readable fallback
// fields, but new UI writes go here. Shape:
// `{ [stageName]: "not_started" | "in_progress" | "complete" | "skipped" }`.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pbc_2985719748');
    collection.fields.add(
      new Field({
        hidden: false,
        id: 'json_pipelineStageStates',
        maxSize: 0,
        name: 'pipelineStageStates',
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
    const field = collection.fields.find((f) => f.name === 'pipelineStageStates');
    if (field) collection.fields.removeById(field.id);
    return app.save(collection);
  },
);

