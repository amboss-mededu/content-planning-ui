/// <reference path="../pb_data/types.d.ts" />

// articleDraftRuns — durable per-article state for the n8n "Draft Article"
// workflow. One row is created before the async n8n job starts, so UI
// progress survives modal close, refresh, and cross-tab navigation. A
// partial unique index prevents two active drafts for the same article. The
// callback flips status to completed/failed and stores the resulting Google
// Drive doc/folder URL in `outputUrl`.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'articleDraftRuns',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule:
          "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'articleKey', required: true, max: 400 },
          { type: 'text', name: 'articleRecordId', required: true, max: 50 },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: ['running', 'completed', 'failed'],
          },
          { type: 'number', name: 'startedAt' },
          { type: 'number', name: 'finishedAt' },
          { type: 'text', name: 'errorMessage', max: 2000 },
          { type: 'text', name: 'handle', max: 200 },
          { type: 'text', name: 'language', max: 100 },
          { type: 'text', name: 'articleLength', max: 100 },
          { type: 'text', name: 'outputUrl', max: 2000 },
        ],
        indexes: [
          'CREATE INDEX `idx_articleDraftRuns_specialty` ON `articleDraftRuns` (`specialtySlug`)',
          'CREATE INDEX `idx_articleDraftRuns_article` ON `articleDraftRuns` (`specialtySlug`, `articleKey`, `startedAt`)',
          'CREATE UNIQUE INDEX `idx_articleDraftRuns_running` ON `articleDraftRuns` (`specialtySlug`, `articleKey`) WHERE `status` = "running"',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('articleDraftRuns');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
