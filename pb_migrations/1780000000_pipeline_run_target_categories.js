/// <reference path="../pb_data/types.d.ts" />

// Record which categories a per-category re-run targeted. The
// consolidate-primary route writes this when the user clicks "Re-run
// consolidation" on a single bucket. The Consolidation Review and
// Categories tabs subscribe to `pipelineRuns` via realtime and use this
// to render a "Rebuilding…" state on the matching buckets — visible in
// both tabs simultaneously without per-tab in-memory state.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('pipelineRuns');
    if (!col.fields.find((f) => f.name === 'targetCategories')) {
      col.fields.add(
        new Field({
          type: 'json',
          name: 'targetCategories',
          maxSize: 200000,
          required: false,
          presentable: false,
          system: false,
          hidden: false,
          id: 'json_targetCategories_pipelineRuns',
        }),
      );
      app.save(col);
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('pipelineRuns');
      const f = col.fields.find((x) => x.name === 'targetCategories');
      if (f) col.fields.removeById(f.id);
      app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
