/// <reference path="../pb_data/types.d.ts" />

// articleBacklog — per-approved-article editorial workflow state.
// One row per article that has had any state change. Absence of a row
// means the article is still in the default "unassigned" status; the
// backlog view treats missing rows as such, so we don't bloat the
// table with default-state rows for every approval.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'articleBacklog',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule:
          "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'articleRecordId', required: true, max: 50 },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: [
              'unassigned',
              'waiting-for-sources',
              'sources-searched',
              'sources-approved',
              'ready-for-llm-draft',
              'ready-for-editing',
              'editing-in-progress',
              'ready-to-publish',
              'published',
            ],
          },
          { type: 'text', name: 'assigneeEmail', max: 320 },
          { type: 'text', name: 'lastChangedByEmail', max: 320 },
          { type: 'number', name: 'lastChangedAt' },
          { type: 'text', name: 'notes', max: 2000 },
        ],
        indexes: [
          'CREATE INDEX `idx_articleBacklog_specialty` ON `articleBacklog` (`specialtySlug`)',
          'CREATE UNIQUE INDEX `idx_articleBacklog_record` ON `articleBacklog` (`specialtySlug`, `articleRecordId`)',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('articleBacklog');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
