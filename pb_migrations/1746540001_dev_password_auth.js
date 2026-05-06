/// <reference path="../pb_data/types.d.ts" />

// DEV TOOLING — re-enables password auth on the users collection so the
// /api/auth/dev-login Next.js route can sign people in without going
// through Google OAuth (useful while waiting for IT to provision the
// OAuth client, and as a fast smoke-test path for CI).
//
// **DELETE THIS MIGRATION (and its row in `_migrations`) AS PART OF THE
// FINAL CLEANUP PR.** Production must use OAuth only.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.passwordAuth = { enabled: true, identityFields: ['email'] };
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.passwordAuth = { enabled: false, identityFields: ['email'] };
    app.save(users);
  },
);
