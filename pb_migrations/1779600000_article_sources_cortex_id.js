/// <reference path="../pb_data/types.d.ts" />

// Add `cortexSourceId` to articleSources so the registration step (Stage 2
// of the article-generation pipeline) can persist the ID returned by the
// Cortex CMS once a source's metadata has been registered there.
//
// No backfill: null = "not yet registered". The Stage 2 trigger walks any
// rows whose cortexSourceId is empty and POSTs the metadata.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleSources');
    if (!col.fields.find((f) => f.name === 'cortexSourceId')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'text_cortexSourceId_articleSources',
          name: 'cortexSourceId',
          max: 200,
          presentable: false,
          required: false,
          system: false,
          type: 'text',
        }),
      );
    }
    const idx =
      'CREATE INDEX `idx_articleSources_cortexSourceId` ON `articleSources` (`cortexSourceId`)';
    if (!col.indexes.find((s) => s === idx)) col.indexes.push(idx);
    app.save(col);
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('articleSources');
      const f = col.fields.find((x) => x.name === 'cortexSourceId');
      if (f) col.fields.removeById(f.id);
      col.indexes = col.indexes.filter((idx) => idx.indexOf('cortexSourceId') === -1);
      app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
