/// <reference path="../pb_data/types.d.ts" />

// Adds the curriculum-mapping time dimension.
//
//   codes.curriculumMeta (json)         — per-block timing for the mapping sheet
//     (year / phase / start-end month / duration / cadence). Populated only for
//     `curriculum-mapping` specialties; null/unset for every other mode.
//   extractedCodes.curriculumMeta (json) — staging mirror; promoted to
//     codes.curriculumMeta when extracted codes are promoted.
//
// No `specialties.pipelineMode` migration is needed — that text field already
// exists (1781400000); `'curriculum-mapping'` is just a new value in it.

const JSON_FIELDS = [
  ['codes', 'json_codes_curriculumMeta'],
  ['extractedCodes', 'json_extractedCodes_curriculumMeta'],
];

migrate(
  (app) => {
    for (const [collectionName, fieldId] of JSON_FIELDS) {
      const collection = app.findCollectionByNameOrId(collectionName);
      if (!collection.fields.find((f) => f.name === 'curriculumMeta')) {
        collection.fields.add(
          new Field({
            id: fieldId,
            type: 'json',
            name: 'curriculumMeta',
            required: false,
            system: false,
            hidden: false,
            presentable: false,
            maxSize: 0,
          }),
        );
        app.save(collection);
      }
    }
  },
  (app) => {
    for (const [collectionName] of JSON_FIELDS) {
      const collection = app.findCollectionByNameOrId(collectionName);
      const f = collection.fields.find((x) => x.name === 'curriculumMeta');
      if (f) {
        collection.fields.removeById(f.id);
        app.save(collection);
      }
    }
  },
);
