/// <reference path="../pb_data/types.d.ts" />

// Adds the `studyPlans` collection — saved selections of curriculum categories
// the user composes from a curriculum plan's Overview page ("Create study
// plan"). For now a study plan is metadata only: a name + the set of curriculum
// category strings it includes, scoped to a curriculum plan via `specialtySlug`
// (same link the `codes` rows use). No downstream generation yet.
//
//   studyPlans.specialtySlug      (text)  — owning curriculum plan slug.
//   studyPlans.name               (text)  — editor-given plan name.
//   studyPlans.selectedCategories (json)  — array of category strings.
//   studyPlans.createdBy          (text)  — creator email (best effort).
//
// `created` / `updated` autodate fields are declared explicitly — PB 0.37 does
// not auto-add them to base collections, and the browser live-update hook
// (`useLiveCollection`) keys row freshness off `updated` (same reason as
// 1781600000_codes_autodate).

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'studyPlans',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'name', required: true, max: 500 },
          { type: 'json', name: 'selectedCategories', maxSize: 0 },
          { type: 'text', name: 'createdBy', max: 200 },
          {
            type: 'autodate',
            name: 'created',
            onCreate: true,
            onUpdate: false,
          },
          {
            type: 'autodate',
            name: 'updated',
            onCreate: true,
            onUpdate: true,
          },
        ],
        indexes: [
          'CREATE INDEX `idx_studyPlans_specialtySlug` ON `studyPlans` (`specialtySlug`)',
        ],
      }),
    );
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('studyPlans');
      app.delete(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
