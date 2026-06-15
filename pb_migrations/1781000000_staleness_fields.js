/// <reference path="../pb_data/types.d.ts" />

// Staleness model — replaces the old global consolidation lock with a
// derived "this bucket's consolidation is out of date" signal.
//
// - codes.consolidationInputChangedAt (unix-ms): stamped whenever a
//   consolidation-relevant field on a code actually changes value. A
//   bucket is stale when any of its codes changed after the bucket was
//   last consolidated.
// - codeCategories.consolidatedAt (unix-ms): when this bucket's primary
//   consolidation last ran (stamped with the run's START time so edits
//   made mid-run still read as stale afterwards).
// - codeCategories.inputChangedAt (unix-ms): bucket-level dirty stamp for
//   changes not attributable to a code currently IN the bucket — namely a
//   code LEAVING the bucket (the new bucket goes stale via the code's own
//   consolidationInputChangedAt).
//
// Staleness is derived: isStale = hasOutput && max(codes' changed, bucket
// changed) > consolidatedAt. See deriveBucketStaleness in
// src/lib/workflows/consolidation/buckets.ts.
//
// Backfill: codeCategories rows already marked isConsolidated get
// consolidatedAt = now so existing consolidated buckets start FRESH, not
// stale. codes.consolidationInputChangedAt stays 0 (no prior edits to
// account for).

migrate(
  (app) => {
    const codes = app.findCollectionByNameOrId('codes');
    codes.fields.add(
      new Field({
        type: 'number',
        name: 'consolidationInputChangedAt',
        required: false,
      }),
    );
    app.save(codes);

    const categories = app.findCollectionByNameOrId('codeCategories');
    categories.fields.add(
      new Field({
        type: 'number',
        name: 'consolidatedAt',
        required: false,
      }),
    );
    categories.fields.add(
      new Field({
        type: 'number',
        name: 'inputChangedAt',
        required: false,
      }),
    );
    app.save(categories);

    const now = Date.now();
    const rows = app.findAllRecords('codeCategories');
    for (const r of rows) {
      if (r.get('isConsolidated') === true) {
        r.set('consolidatedAt', now);
        app.save(r);
      }
    }
  },
  (app) => {
    const codes = app.findCollectionByNameOrId('codes');
    const inputChanged = codes.fields.find(
      (f) => f.name === 'consolidationInputChangedAt',
    );
    if (inputChanged) codes.fields.removeById(inputChanged.id);
    app.save(codes);

    const categories = app.findCollectionByNameOrId('codeCategories');
    for (const name of ['consolidatedAt', 'inputChangedAt']) {
      const field = categories.fields.find((f) => f.name === name);
      if (field) categories.fields.removeById(field.id);
    }
    return app.save(categories);
  },
);
