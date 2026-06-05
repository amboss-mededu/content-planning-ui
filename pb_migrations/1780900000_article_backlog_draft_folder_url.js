/// <reference path="../pb_data/types.d.ts" />

// Add `draftFolderUrl` to articleBacklog — a single, editable, per-article
// pointer to the Google Drive folder for the latest draft. Set by the n8n
// draft callback (early "folder ready" ping while the draft is still running,
// and again on completion so a re-run overwrites it), and manually editable by
// users in the backlog table + article modal. Empty = no draft folder yet.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleBacklog');
    if (!col.fields.find((f) => f.name === 'draftFolderUrl')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'text_draftFolderUrl_articleBacklog',
          name: 'draftFolderUrl',
          max: 2000,
          presentable: false,
          required: false,
          system: false,
          type: 'text',
        }),
      );
    }
    return app.save(col);
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('articleBacklog');
      const f = col.fields.find((x) => x.name === 'draftFolderUrl');
      if (f) col.fields.removeById(f.id);
      return app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
