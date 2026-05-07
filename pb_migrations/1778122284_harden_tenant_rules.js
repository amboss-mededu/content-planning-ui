/// <reference path="../pb_data/types.d.ts" />

// Defense-in-depth tenant scoping.
//
// Every per-specialty / per-run collection used to ship with API rules of
// the shape `@request.auth.id != ''` — i.e. "any authed user can do
// anything." That's correct for the audience (small admin team), but it
// means data integrity for `specialtySlug` / `runId` is enforced purely
// by app-side discipline. A buggy query, a typo in a CLI script, or a
// fat-finger in the PB admin UI can:
//
//   - Create a row whose `specialtySlug` doesn't reference any real
//     specialty (orphan row).
//   - Rewrite an existing row's `specialtySlug` to a different specialty,
//     silently relocating it across tenants.
//
// This migration tightens createRule + updateRule so PB rejects both
// classes of write at the API layer:
//
//   createRule: parent row (specialty / pipelineRun) must already exist
//   updateRule: if the request body sets specialtySlug / runId, the value
//               must equal the existing column value (i.e. no-op rewrite).
//               Updates that don't touch the field at all pass freely.
//
// list / view / delete rules stay permissive — admins should still be
// able to browse across specialties and clean up rows.
//
// Superuser caveat: PocketBase API rules apply to user-authed clients
// (cookie-authed RSC/route-handler traffic). Superuser-authed clients
// (`createAdminClient` in src/lib/pb/server.ts) bypass them by design.
// In this app that's: the workflow phase functions, the OAuth callback,
// and the dev-autologin route. Those paths are trusted to use real
// slugs and are explicitly privileged; this migration doesn't try to
// patch over that. If we ever want universal enforcement, add equivalent
// checks as `onRecordCreateRequest` / `onRecordUpdateRequest` hooks in
// `pb_hooks/main.pb.js` — hooks fire regardless of auth.

const PER_SPECIALTY_COLLECTIONS = [
  'codes',
  'codeCategories',
  'consolidatedArticles',
  'newArticleSuggestions',
  'articleUpdateSuggestions',
  'consolidatedSections',
  'pipelineRuns',
  'extractedCodes',
];

const PER_RUN_COLLECTIONS = ['pipelineStages', 'pipelineEvents'];

const SPECIALTY_CREATE_RULE =
  "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug";
const SPECIALTY_UPDATE_RULE =
  "@request.auth.id != '' && (@request.body.specialtySlug:isset = false || @request.body.specialtySlug = specialtySlug)";

const RUN_CREATE_RULE =
  "@request.auth.id != '' && @collection.pipelineRuns.id ?= @request.body.runId";
const RUN_UPDATE_RULE =
  "@request.auth.id != '' && (@request.body.runId:isset = false || @request.body.runId = runId)";

// mappingsInFlight has BOTH specialtySlug and runId — combine both checks.
const MAPPINGS_IN_FLIGHT_CREATE_RULE = `${SPECIALTY_CREATE_RULE} && @collection.pipelineRuns.id ?= @request.body.runId`;
const MAPPINGS_IN_FLIGHT_UPDATE_RULE = `${SPECIALTY_UPDATE_RULE} && (@request.body.runId:isset = false || @request.body.runId = runId)`;

const PERMISSIVE = "@request.auth.id != ''";

migrate(
  (app) => {
    for (const name of PER_SPECIALTY_COLLECTIONS) {
      const col = app.findCollectionByNameOrId(name);
      col.createRule = SPECIALTY_CREATE_RULE;
      col.updateRule = SPECIALTY_UPDATE_RULE;
      app.save(col);
    }
    for (const name of PER_RUN_COLLECTIONS) {
      const col = app.findCollectionByNameOrId(name);
      col.createRule = RUN_CREATE_RULE;
      col.updateRule = RUN_UPDATE_RULE;
      app.save(col);
    }
    {
      const col = app.findCollectionByNameOrId('mappingsInFlight');
      col.createRule = MAPPINGS_IN_FLIGHT_CREATE_RULE;
      col.updateRule = MAPPINGS_IN_FLIGHT_UPDATE_RULE;
      app.save(col);
    }
  },
  (app) => {
    const all = [
      ...PER_SPECIALTY_COLLECTIONS,
      ...PER_RUN_COLLECTIONS,
      'mappingsInFlight',
    ];
    for (const name of all) {
      const col = app.findCollectionByNameOrId(name);
      col.createRule = PERMISSIVE;
      col.updateRule = PERMISSIVE;
      app.save(col);
    }
  },
);
