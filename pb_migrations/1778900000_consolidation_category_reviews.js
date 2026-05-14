/// <reference path="../pb_data/types.d.ts" />

// consolidationCategoryReviews — editor-facing per-category state for the
// Consolidation Review screen. One row per (specialtySlug, category) pair.
// Used solely to surface "this category needs the consolidation pipeline
// re-run" — per-row approvals stay on articleReviews / sectionReviews. The
// "all approved" state is derived at read time from those collections, so
// no 'approved' value is persisted here.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'consolidationCategoryReviews',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule:
          "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
        updateRule:
          "@request.auth.id != '' && (@request.body.specialtySlug:isset = false || @request.body.specialtySlug = specialtySlug)",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'category', required: true, max: 200 },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: ['flagged-for-rerun'],
          },
          { type: 'text', name: 'reviewerEmail', max: 320 },
          { type: 'number', name: 'reviewedAt' },
          { type: 'text', name: 'notes', max: 2000 },
        ],
        indexes: [
          'CREATE INDEX `idx_consolidationCategoryReviews_specialty` ON `consolidationCategoryReviews` (`specialtySlug`)',
          'CREATE UNIQUE INDEX `idx_consolidationCategoryReviews_category` ON `consolidationCategoryReviews` (`specialtySlug`, `category`)',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('consolidationCategoryReviews');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
