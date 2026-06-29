/// <reference path="../pb_data/types.d.ts" />

// Adds the curriculum-mapping human-in-the-loop approval gate. In
// curriculum-mapping mode a code row IS a curriculum item; only APPROVED items
// are mapped (articles + questions). The status lives directly on the code row.
//
//   codes.curriculumReviewStatus (text) — '' (pending) | 'approved' | 'rejected'.
//   codes.curriculumReviewedAt (number) — epoch ms the decision was stamped.
//   codes.curriculumReviewedBy (text)   — reviewer email.
//
// Additive only — existing rows default to '' (pending). Curriculum-mapping
// only; other modes never set these.

migrate(
  (app) => {
    const codes = app.findCollectionByNameOrId('codes');
    let dirty = false;

    if (!codes.fields.find((f) => f.name === 'curriculumReviewStatus')) {
      codes.fields.add(
        new Field({
          id: 'text_codes_curriculumReviewStatus',
          type: 'text',
          name: 'curriculumReviewStatus',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
        }),
      );
      dirty = true;
    }

    if (!codes.fields.find((f) => f.name === 'curriculumReviewedAt')) {
      codes.fields.add(
        new Field({
          id: 'number_codes_curriculumReviewedAt',
          type: 'number',
          name: 'curriculumReviewedAt',
          required: false,
          system: false,
          hidden: false,
        }),
      );
      dirty = true;
    }

    if (!codes.fields.find((f) => f.name === 'curriculumReviewedBy')) {
      codes.fields.add(
        new Field({
          id: 'text_codes_curriculumReviewedBy',
          type: 'text',
          name: 'curriculumReviewedBy',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
        }),
      );
      dirty = true;
    }

    if (dirty) app.save(codes);
  },
  (app) => {
    const codes = app.findCollectionByNameOrId('codes');
    let dirty = false;
    for (const name of [
      'curriculumReviewStatus',
      'curriculumReviewedAt',
      'curriculumReviewedBy',
    ]) {
      const f = codes.fields.find((x) => x.name === name);
      if (f) {
        codes.fields.removeById(f.id);
        dirty = true;
      }
    }
    if (dirty) app.save(codes);
  },
);
