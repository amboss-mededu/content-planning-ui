/// <reference path="../pb_data/types.d.ts" />

// The initial PB schema flattened the ontology collections (icd10Codes,
// hcupCodes, abimCodes, orphaCodes) to a generic `code/description/
// parent/category` shape. That doesn't match either the app's view code
// (`src/app/planning/_components/sources-view.tsx` expects rich per-source
// fields like primaryCategory/tertiaryCategory/disease for ABIM,
// orphaCode/specificName for Orpha, etc.) or the xlsx fixtures we seed
// from. Result: clicking "Sources → ICD10" 400s because the filter
// references a `specialtySlug` field that doesn't exist.
//
// All four collections are currently empty (verified before this
// migration), so we drop and recreate with the per-source field set the
// app actually uses, plus a required `specialtySlug` (so ontology is
// per-specialty, mirroring how the xlsx is organised) and the same
// tenant-scoping rules as the rest of the per-specialty collections.

const PER_SPECIALTY_RULES = {
  listRule: "@request.auth.id != ''",
  viewRule: "@request.auth.id != ''",
  createRule:
    "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
  updateRule:
    "@request.auth.id != '' && (@request.body.specialtySlug:isset = false || @request.body.specialtySlug = specialtySlug)",
  deleteRule: "@request.auth.id != ''",
};

const ONTOLOGY_DEFS = [
  {
    name: 'icd10Codes',
    fields: [
      { type: 'text', name: 'specialtySlug', required: true, max: 200 },
      { type: 'text', name: 'codeCategory', max: 0 },
      { type: 'text', name: 'icd10Code', required: true, max: 50 },
      { type: 'text', name: 'icd10CodeDescription', max: 0 },
    ],
    indexes: [
      'CREATE INDEX `idx_icd10Codes_specialty` ON `icd10Codes` (`specialtySlug`)',
      'CREATE INDEX `idx_icd10Codes_code` ON `icd10Codes` (`icd10Code`)',
    ],
  },
  {
    name: 'hcupCodes',
    fields: [
      { type: 'text', name: 'specialtySlug', required: true, max: 200 },
      { type: 'text', name: 'codeCategory', max: 0 },
      { type: 'text', name: 'icd10Code', required: true, max: 50 },
      { type: 'text', name: 'icd10CodeDescription', max: 0 },
    ],
    indexes: [
      'CREATE INDEX `idx_hcupCodes_specialty` ON `hcupCodes` (`specialtySlug`)',
      'CREATE INDEX `idx_hcupCodes_code` ON `hcupCodes` (`icd10Code`)',
    ],
  },
  {
    name: 'abimCodes',
    fields: [
      { type: 'text', name: 'specialtySlug', required: true, max: 200 },
      { type: 'number', name: 'abimIndex' },
      { type: 'text', name: 'primaryCategory', max: 0 },
      { type: 'text', name: 'secondaryCategory', max: 0 },
      { type: 'text', name: 'tertiaryCategory', max: 0 },
      { type: 'text', name: 'disease', max: 0 },
      { type: 'text', name: 'specialty', max: 200 },
      { type: 'text', name: 'code', max: 100 },
      { type: 'text', name: 'item', max: 0 },
      { type: 'text', name: 'choice', max: 0 },
      { type: 'text', name: 'category', max: 0 },
      { type: 'number', name: 'count' },
    ],
    indexes: [
      'CREATE INDEX `idx_abimCodes_specialty` ON `abimCodes` (`specialtySlug`)',
    ],
  },
  {
    name: 'orphaCodes',
    fields: [
      { type: 'text', name: 'specialtySlug', required: true, max: 200 },
      { type: 'text', name: 'orphaCode', required: true, max: 50 },
      { type: 'text', name: 'parentOrphaCode', max: 50 },
      { type: 'text', name: 'specificName', max: 0 },
      { type: 'text', name: 'parentCategory', max: 0 },
      { type: 'text', name: 'orphaTargetFilenamesToInclude', max: 0 },
      { type: 'text', name: 'icd10LettersToInclude', max: 0 },
      { type: 'number', name: 'count' },
    ],
    indexes: [
      'CREATE INDEX `idx_orphaCodes_specialty` ON `orphaCodes` (`specialtySlug`)',
      'CREATE INDEX `idx_orphaCodes_orpha` ON `orphaCodes` (`orphaCode`)',
    ],
  },
];

migrate(
  (app) => {
    for (const def of ONTOLOGY_DEFS) {
      // Drop existing collection (empty) so we can land the rich shape
      // cleanly without per-field add/remove churn.
      try {
        const existing = app.findCollectionByNameOrId(def.name);
        app.delete(existing);
      } catch (_) {
        /* not present — fine */
      }
      app.save(
        new Collection({
          type: 'base',
          name: def.name,
          ...PER_SPECIALTY_RULES,
          fields: def.fields,
          indexes: def.indexes,
        }),
      );
    }
  },
  (app) => {
    // Down: restore the original simplified shape (no specialtySlug).
    for (const def of ONTOLOGY_DEFS) {
      try {
        const existing = app.findCollectionByNameOrId(def.name);
        app.delete(existing);
      } catch (_) {
        /* not present — fine */
      }
      app.save(
        new Collection({
          type: 'base',
          name: def.name,
          listRule: "@request.auth.id != ''",
          viewRule: "@request.auth.id != ''",
          createRule: "@request.auth.id != ''",
          updateRule: "@request.auth.id != ''",
          deleteRule: "@request.auth.id != ''",
          fields: [
            { type: 'text', name: 'code', required: true, max: 50 },
            { type: 'text', name: 'description' },
            { type: 'text', name: 'parent', max: 50 },
            { type: 'text', name: 'category', max: 200 },
          ],
          indexes: [
            'CREATE INDEX `idx_' + def.name + '_code` ON `' + def.name + '` (`code`)',
          ],
        }),
      );
    }
  },
);
