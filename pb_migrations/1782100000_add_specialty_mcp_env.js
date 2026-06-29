/// <reference path="../pb_data/types.d.ts" />

// Adds `specialties.mcpEnv` — which AMBOSS MCP environment a rag-corpus
// specialty's mapping/literature runs query: 'production' (default) or
// 'staging' (→ AMBOSS_MCP_URL_STAGING). Empty/absent reads as 'production' at
// the TS layer, so existing specialties keep hitting the production MCP server.
// Selected per-specialty via the rag-corpus "MCP server" control in the
// add/settings modals; resolved at run time by `resolveAmbossMcp`.

migrate(
  (app) => {
    const specialties = app.findCollectionByNameOrId('specialties');
    if (!specialties.fields.find((f) => f.name === 'mcpEnv')) {
      specialties.fields.add(
        new Field({
          id: 'select_specialties_mcpEnv',
          type: 'select',
          name: 'mcpEnv',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
          maxSelect: 1,
          values: ['production', 'staging'],
        }),
      );
    }
    app.save(specialties);
  },
  (app) => {
    const specialties = app.findCollectionByNameOrId('specialties');
    const field = specialties.fields.find((f) => f.name === 'mcpEnv');
    if (field) specialties.fields.removeById(field.id);
    return app.save(specialties);
  },
);
