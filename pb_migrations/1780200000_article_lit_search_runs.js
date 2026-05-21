/// <reference path="../pb_data/types.d.ts" />

// articleLitSearchRuns — durable per-article literature-search state.
// One row is created before the async worker starts, so UI progress
// survives modal close, refresh, and cross-tab navigation. A partial
// unique index prevents two active searches for the same article.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'articleLitSearchRuns',
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
          { type: 'text', name: 'runId', max: 50 },
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
          { type: 'number', name: 'queryCount' },
          { type: 'number', name: 'candidateCount' },
          { type: 'number', name: 'sourcesCount' },
        ],
        indexes: [
          'CREATE INDEX `idx_articleLitSearchRuns_specialty` ON `articleLitSearchRuns` (`specialtySlug`)',
          'CREATE INDEX `idx_articleLitSearchRuns_article` ON `articleLitSearchRuns` (`specialtySlug`, `articleKey`, `startedAt`)',
          'CREATE UNIQUE INDEX `idx_articleLitSearchRuns_running` ON `articleLitSearchRuns` (`specialtySlug`, `articleKey`) WHERE `status` = "running"',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('articleLitSearchRuns');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
