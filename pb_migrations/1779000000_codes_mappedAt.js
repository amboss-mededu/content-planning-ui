/// <reference path="../pb_data/types.d.ts" />

// Adds `mappedAt` (unix-ms timestamp) to the codes collection as the
// canonical "mapping has run" signal. The existing `isInAMBOSS` field is
// a PB bool — NOT NULL, default false — so it can't represent "unset",
// which caused freshly-inserted rows to look like they'd been mapped as
// not-in-AMBOSS. From this migration on, the predicate is mappedAt > 0,
// and `isInAMBOSS` is only meaningful when mappedAt > 0.
//
// Backfill: any row that carries mapping evidence (isInAMBOSS=true OR any
// of coverageLevel / notes / gaps / improvements is non-empty) gets a
// non-zero mappedAt so it stays "mapped" after this migration. Rows that
// were stuck at the default-false state without evidence are treated as
// unmapped (mappedAt stays 0).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('codes');
    collection.fields.add(
      new Field({
        type: 'number',
        name: 'mappedAt',
        required: false,
      }),
    );
    app.save(collection);

    const rows = app.findAllRecords('codes');
    const now = Date.now();
    for (const r of rows) {
      const hasEvidence =
        r.get('isInAMBOSS') === true ||
        (r.get('coverageLevel') || '').length > 0 ||
        (r.get('notes') || '').length > 0 ||
        (r.get('gaps') || '').length > 0 ||
        (r.get('improvements') || '').length > 0;
      if (hasEvidence) {
        r.set('mappedAt', now);
        app.save(r);
      }
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('codes');
    const field = collection.fields.find((f) => f.name === 'mappedAt');
    if (field) collection.fields.removeById(field.id);
    return app.save(collection);
  },
);
