/// <reference path="../pb_data/types.d.ts" />

// Add `outputLinks` to articleDraftRuns. The n8n draft workflow now returns a
// Google Drive folder URL (kept in `outputUrl`) plus a per-stage list of the
// generated drafts as `[{ name, link }, ...]` (primary edit, secondary edit,
// proofread, style, html, copy edit, QC). The completion callback stores that
// array here so the UI can surface every intermediate draft, not just the
// folder. Empty/absent = legacy run or none reported.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleDraftRuns');
    if (!col.fields.find((f) => f.name === 'outputLinks')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'json_outputLinks_articleDraftRuns',
          maxSize: 0,
          name: 'outputLinks',
          presentable: false,
          required: false,
          system: false,
          type: 'json',
        }),
      );
    }
    return app.save(col);
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('articleDraftRuns');
      const f = col.fields.find((x) => x.name === 'outputLinks');
      if (f) col.fields.removeById(f.id);
      return app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
