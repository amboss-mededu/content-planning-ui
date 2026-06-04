/// <reference path="../pb_data/types.d.ts" />

// Add a `cancelled` status to the article-run collections so editors can
// manually abort an in-flight literature search or article draft. n8n owns
// the actual job; cancelling just marks the row terminal so the UI unblocks
// and a retry can claim a fresh run. Kept distinct from `failed` so a
// deliberate abort isn't surfaced as an error.

const COLLECTIONS = ['articleLitSearchRuns', 'articleDraftRuns'];

migrate(
  (app) => {
    for (const name of COLLECTIONS) {
      const collection = app.findCollectionByNameOrId(name);
      const field = collection.fields.find((f) => f.name === 'status');
      field.values = ['running', 'completed', 'failed', 'cancelled'];
      app.save(collection);
    }
  },
  (app) => {
    for (const name of COLLECTIONS) {
      try {
        const collection = app.findCollectionByNameOrId(name);
        // Flip any cancelled rows to failed so they stay valid under the
        // narrowed value set.
        const rows = app.findAllRecords(name);
        for (const r of rows) {
          if (r.get('status') === 'cancelled') {
            r.set('status', 'failed');
            app.save(r);
          }
        }
        const field = collection.fields.find((f) => f.name === 'status');
        field.values = ['running', 'completed', 'failed'];
        app.save(collection);
      } catch (_) {
        /* collection missing — fine */
      }
    }
  },
);
