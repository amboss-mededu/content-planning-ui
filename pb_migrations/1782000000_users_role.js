/// <reference path="../pb_data/types.d.ts" />

// Adds a `role` field to the users collection, distinguishing content
// architects (content leads who run the pipeline, control what reaches the
// backlog, and assign editors) from individual medical editors (who only see
// their assigned My Backlog). Defaults to 'editor' (least privilege): existing
// and new users are editors unless promoted. The first architects are
// bootstrapped at sign-up via the CONTENT_ARCHITECT_ALLOWLIST env in
// pb_hooks/main.pb.js; thereafter architects promote others from the in-app
// Settings "Team roles" panel.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('users');
    collection.fields.add(
      new Field({
        type: 'select',
        name: 'role',
        required: false,
        maxSelect: 1,
        values: ['editor', 'architect'],
      }),
    );
    app.save(collection);

    // Backfill existing users so they explicitly carry role='editor'. App code
    // also read-time-defaults empty/unknown roles to editor (see
    // src/lib/auth/roles.ts), but stamping the value keeps PB filters like
    // `role = "architect"` honest without null handling at every query site.
    const rows = app.findAllRecords('users');
    for (const r of rows) {
      if (!r.get('role')) {
        r.set('role', 'editor');
        app.save(r);
      }
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('users');
    const field = collection.fields.find((f) => f.name === 'role');
    if (field) collection.fields.removeById(field.id);
    return app.save(collection);
  },
);
