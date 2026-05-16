/// <reference path="../pb_data/types.d.ts" />

// Per-source editor decision on articleSources. Lets the editor
// approve / reject individual sources after lit search, mirroring the
// article-review pattern but lighter (no decision-note rail, no
// auto-advance). Empty / null = not yet reviewed.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleSources');
    let dirty = false;
    if (!col.fields.find((f) => f.name === 'reviewStatus')) {
      col.fields.add(
        new Field({
          type: 'select',
          name: 'reviewStatus',
          values: ['approved', 'rejected'],
          maxSelect: 1,
          required: false,
          presentable: false,
          system: false,
          hidden: false,
          id: 'select_reviewStatus_articleSources',
        }),
      );
      dirty = true;
    }
    if (!col.fields.find((f) => f.name === 'reviewerEmail')) {
      col.fields.add(
        new Field({
          type: 'text',
          name: 'reviewerEmail',
          max: 320,
          required: false,
          presentable: false,
          system: false,
          hidden: false,
          id: 'text_reviewerEmail_articleSources',
        }),
      );
      dirty = true;
    }
    if (!col.fields.find((f) => f.name === 'reviewedAt')) {
      col.fields.add(
        new Field({
          type: 'number',
          name: 'reviewedAt',
          required: false,
          presentable: false,
          system: false,
          hidden: false,
          id: 'number_reviewedAt_articleSources',
        }),
      );
      dirty = true;
    }
    if (dirty) app.save(col);
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('articleSources');
      for (const name of ['reviewStatus', 'reviewerEmail', 'reviewedAt']) {
        const f = col.fields.find((x) => x.name === name);
        if (f) col.fields.removeById(f.id);
      }
      app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
