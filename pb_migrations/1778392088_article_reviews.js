/// <reference path="../pb_data/types.d.ts" />

// articleReviews — editor-facing approval state for the consolidation
// review pass on the New Articles tab. One row per (specialtySlug,
// articleRecordId) pair, where articleRecordId is the PB id of a
// `consolidatedArticles` row (the 1st-pass output the editor is
// reviewing). Re-running the consolidation clears consolidatedArticles
// and these rows become orphans — acceptable for v1: editors re-review
// after a re-run.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'articleReviews',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule:
          "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
        updateRule:
          "@request.auth.id != '' && (@request.body.specialtySlug:isset = false || @request.body.specialtySlug = specialtySlug)",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'articleRecordId', required: true, max: 50 },
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
          'CREATE INDEX `idx_articleReviews_specialty` ON `articleReviews` (`specialtySlug`)',
          'CREATE UNIQUE INDEX `idx_articleReviews_article` ON `articleReviews` (`specialtySlug`, `articleRecordId`)',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('articleReviews');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
