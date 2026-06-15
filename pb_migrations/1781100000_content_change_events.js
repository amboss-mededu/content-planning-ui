/// <reference path="../pb_data/types.d.ts" />

// contentChangeEvents — CMS article/section change feed, ingested
// cursor-based from the content-change feed adapter. Events are
// CMS-global (no specialtySlug); specialty filtering happens at join
// time in computeDriftImpacts. `eventKey` is the idempotency key, so a
// re-synced window upserts rather than duplicating.
//
// integrationState — generic key/value store; holds the feed cursor
// under key "contentChangeFeedCursor" so missed sync windows resume
// from the last persisted position.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'contentChangeEvents',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'eventKey', required: true, max: 400 },
          { type: 'text', name: 'articleEid', required: true, max: 200 },
          { type: 'text', name: 'sectionId', max: 200 },
          {
            type: 'select',
            name: 'changeType',
            required: true,
            maxSelect: 1,
            values: ['renamed', 'moved', 'archived', 'merged', 'deleted'],
          },
          { type: 'text', name: 'newTitle', max: 500 },
          { type: 'text', name: 'mergedIntoEid', max: 200 },
          { type: 'number', name: 'occurredAt' },
          { type: 'number', name: 'ingestedAt' },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: ['open', 'resolved'],
          },
          { type: 'text', name: 'resolvedBy', max: 200 },
          { type: 'number', name: 'resolvedAt' },
          { type: 'text', name: 'notes', max: 2000 },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_contentChangeEvents_eventKey` ON `contentChangeEvents` (`eventKey`)',
          'CREATE INDEX `idx_contentChangeEvents_status_eid` ON `contentChangeEvents` (`status`, `articleEid`)',
        ],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'integrationState',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'key', required: true, max: 200 },
          { type: 'json', name: 'value', maxSize: 100000 },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_integrationState_key` ON `integrationState` (`key`)',
        ],
      }),
    );
  },
  (app) => {
    for (const name of ['contentChangeEvents', 'integrationState']) {
      try {
        const existing = app.findCollectionByNameOrId(name);
        app.delete(existing);
      } catch (_) {
        /* not present — fine */
      }
    }
  },
);
