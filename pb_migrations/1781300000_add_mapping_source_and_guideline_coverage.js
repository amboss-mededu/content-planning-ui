/// <reference path="../pb_data/types.d.ts" />

// Adds the "mapping source" feature: a specialty can be mapped against AMBOSS
// content, clinical guidelines, or both.
//
//   specialties.mappingSource (text) — 'amboss' | 'guidelines' | 'both'.
//     Empty/absent defaults to 'amboss' at the TS layer (today's behaviour).
//
//   codes.* (guideline coverage track) — mirror of the existing AMBOSS
//     coverage columns, populated when the source includes guidelines.
//   codes.overall* — the synthesized (source='both') or active-source coverage,
//     read by the stats/overview with a `?? depthOfCoverage` fallback.
//   codes.mappingSourceUsed (text) — which source(s) produced this row's
//     mapping, so the UI can render the right columns per row even if the
//     specialty setting later changes.

const CODES_TEXT_FIELDS = [
  ['text_codes_guidelineCoverageLevel', 'guidelineCoverageLevel'],
  ['text_codes_guidelineNotes', 'guidelineNotes'],
  ['text_codes_guidelineGaps', 'guidelineGaps'],
  ['text_codes_overallCoverageLevel', 'overallCoverageLevel'],
  ['text_codes_mappingSourceUsed', 'mappingSourceUsed'],
];

const CODES_NUMBER_FIELDS = [
  ['number_codes_guidelineDepthOfCoverage', 'guidelineDepthOfCoverage'],
  ['number_codes_guidelineCount', 'guidelineCount'],
  ['number_codes_guidelineRecommendationCount', 'guidelineRecommendationCount'],
  ['number_codes_overallDepthOfCoverage', 'overallDepthOfCoverage'],
];

migrate(
  (app) => {
    const specialties = app.findCollectionByNameOrId('specialties');
    if (!specialties.fields.find((f) => f.name === 'mappingSource')) {
      specialties.fields.add(
        new Field({
          id: 'text_specialties_mappingSource',
          type: 'text',
          name: 'mappingSource',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
        }),
      );
      app.save(specialties);
    }

    const codes = app.findCollectionByNameOrId('codes');
    let dirty = false;

    if (!codes.fields.find((f) => f.name === 'isInGuidelines')) {
      codes.fields.add(
        new Field({
          id: 'bool_codes_isInGuidelines',
          type: 'bool',
          name: 'isInGuidelines',
          required: false,
          system: false,
          hidden: false,
        }),
      );
      dirty = true;
    }

    for (const [id, name] of CODES_TEXT_FIELDS) {
      if (!codes.fields.find((f) => f.name === name)) {
        codes.fields.add(
          new Field({ id, type: 'text', name, required: false, system: false, hidden: false }),
        );
        dirty = true;
      }
    }

    for (const [id, name] of CODES_NUMBER_FIELDS) {
      if (!codes.fields.find((f) => f.name === name)) {
        codes.fields.add(
          new Field({ id, type: 'number', name, required: false, system: false, hidden: false }),
        );
        dirty = true;
      }
    }

    if (!codes.fields.find((f) => f.name === 'guidelinesWhereCoverageIs')) {
      codes.fields.add(
        new Field({
          id: 'json_codes_guidelinesWhereCoverageIs',
          type: 'json',
          name: 'guidelinesWhereCoverageIs',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
          maxSize: 0,
        }),
      );
      dirty = true;
    }

    if (dirty) app.save(codes);
  },
  (app) => {
    const specialties = app.findCollectionByNameOrId('specialties');
    const ms = specialties.fields.find((f) => f.name === 'mappingSource');
    if (ms) {
      specialties.fields.removeById(ms.id);
      app.save(specialties);
    }

    const codes = app.findCollectionByNameOrId('codes');
    const names = [
      'isInGuidelines',
      'guidelinesWhereCoverageIs',
      ...CODES_TEXT_FIELDS.map(([, name]) => name),
      ...CODES_NUMBER_FIELDS.map(([, name]) => name),
    ];
    let dirty = false;
    for (const name of names) {
      const f = codes.fields.find((x) => x.name === name);
      if (f) {
        codes.fields.removeById(f.id);
        dirty = true;
      }
    }
    if (dirty) app.save(codes);
  },
);
