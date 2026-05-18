/// <reference path="../pb_data/types.d.ts" />

// Persist the requesting user's PB id on every articleWritingRuns row so
// the background dispatcher can resolve the right per-user API key at
// dispatch time (the request-time cookie is long gone by the time the
// worker dequeues a run minutes later).
//
// Backfill: best-effort lookup by `requestedByEmail` → users.id; rows
// where the email is empty or doesn't resolve keep an empty userId.
// The dispatcher falls back to env-level keys when userId is empty.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleWritingRuns');
    if (!col.fields.find((f) => f.name === 'requestedByUserId')) {
      col.fields.add(
        new Field({
          hidden: false,
          id: 'text_requestedByUserId_writingRuns',
          name: 'requestedByUserId',
          max: 50,
          presentable: false,
          required: false,
          system: false,
          type: 'text',
        }),
      );
      app.save(col);
    }

    // Best-effort backfill.
    const users = app.findAllRecords('users');
    const idByEmail = {};
    for (const u of users) {
      const email = u.get('email');
      if (email) idByEmail[email] = u.id;
    }
    const rows = app.findAllRecords('articleWritingRuns');
    for (const r of rows) {
      const email = r.get('requestedByEmail');
      const uid = email ? idByEmail[email] : null;
      if (uid && !r.get('requestedByUserId')) {
        r.set('requestedByUserId', uid);
        app.save(r);
      }
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('articleWritingRuns');
      const f = col.fields.find((x) => x.name === 'requestedByUserId');
      if (f) col.fields.removeById(f.id);
      app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
