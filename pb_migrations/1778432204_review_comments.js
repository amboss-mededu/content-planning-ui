/// <reference path="../pb_data/types.d.ts" />

// reviewComments — editor-facing comment thread on each article or
// section in the review pass. Polymorphic so a single fetch covers
// both article and section threads; recordKind discriminates which
// review collection the recordId belongs to.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'reviewComments',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule:
          "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          {
            type: 'select',
            name: 'recordKind',
            required: true,
            maxSelect: 1,
            values: ['article', 'section'],
          },
          { type: 'text', name: 'recordId', required: true, max: 50 },
          { type: 'text', name: 'authorEmail', max: 320 },
          { type: 'text', name: 'body', required: true, max: 4000 },
        ],
        indexes: [
          'CREATE INDEX `idx_reviewComments_specialty` ON `reviewComments` (`specialtySlug`)',
          'CREATE INDEX `idx_reviewComments_record` ON `reviewComments` (`specialtySlug`, `recordKind`, `recordId`)',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('reviewComments');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
