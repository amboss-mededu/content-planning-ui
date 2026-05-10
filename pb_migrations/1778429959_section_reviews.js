/// <reference path="../pb_data/types.d.ts" />

// sectionReviews — editor-facing approval state for the review pass on
// the Article Updates tab. Mirrors articleReviews: one row per
// (specialtySlug, sectionRecordId) where sectionRecordId is the PB id
// of a `consolidatedSections` row. Re-running the section consolidation
// clears that table and the reviews become orphans (re-run = re-review).

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'sectionReviews',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule:
          "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
        updateRule:
          "@request.auth.id != '' && (@request.body.specialtySlug:isset = false || @request.body.specialtySlug = specialtySlug)",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'sectionRecordId', required: true, max: 50 },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: ['approved', 'rejected'],
          },
          { type: 'text', name: 'reviewerEmail', max: 320 },
          { type: 'number', name: 'reviewedAt' },
          { type: 'text', name: 'notes', max: 2000 },
        ],
        indexes: [
          'CREATE INDEX `idx_sectionReviews_specialty` ON `sectionReviews` (`specialtySlug`)',
          'CREATE UNIQUE INDEX `idx_sectionReviews_section` ON `sectionReviews` (`specialtySlug`, `sectionRecordId`)',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('sectionReviews');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
