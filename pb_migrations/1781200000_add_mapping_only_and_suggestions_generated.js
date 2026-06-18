/// <reference path="../pb_data/types.d.ts" />

// Two additive fields for the "Mapping only" specialty mode:
//   specialties.mappingOnly (bool)       — when true the specialty runs
//     coverage mapping only; consolidation / suggestion / backlog / drift
//     surfaces are hidden and the map-codes prompt drops the suggestion
//     portion of its chain-of-thought.
//   codes.suggestionsGeneratedAt (number, ms) — stamped once a code has been
//     processed for suggestions (by the combined full-mode map write or by
//     the separate "Generate suggestions" backfill). Distinguishes "never
//     generated" from "generated, legitimately empty" so the backfill stage
//     can target only the codes that still need suggestions.

migrate(
  (app) => {
    const specialties = app.findCollectionByNameOrId('specialties');
    if (!specialties.fields.find((f) => f.name === 'mappingOnly')) {
      specialties.fields.add(
        new Field({
          id: 'bool_specialties_mappingOnly',
          type: 'bool',
          name: 'mappingOnly',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
        }),
      );
      app.save(specialties);
    }

    const codes = app.findCollectionByNameOrId('codes');
    if (!codes.fields.find((f) => f.name === 'suggestionsGeneratedAt')) {
      codes.fields.add(
        new Field({
          id: 'number_codes_suggestionsGeneratedAt',
          type: 'number',
          name: 'suggestionsGeneratedAt',
          required: false,
          system: false,
          hidden: false,
        }),
      );
      app.save(codes);
    }
  },
  (app) => {
    const specialties = app.findCollectionByNameOrId('specialties');
    const mappingOnly = specialties.fields.find((f) => f.name === 'mappingOnly');
    if (mappingOnly) {
      specialties.fields.removeById(mappingOnly.id);
      app.save(specialties);
    }

    const codes = app.findCollectionByNameOrId('codes');
    const suggGen = codes.fields.find((f) => f.name === 'suggestionsGeneratedAt');
    if (suggGen) {
      codes.fields.removeById(suggGen.id);
      app.save(codes);
    }
  },
);
