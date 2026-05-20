/// <reference path="../pb_data/types.d.ts" />

// articleUpdateSuggestions was originally cloned from the new-article
// suggestion sheet shape, which meant PocketBase silently dropped section
// fields emitted by consolidation. Add the section-specific columns so the
// primary consolidation output can survive into the secondary/final tables.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('articleUpdateSuggestions');

    function addField(name, field) {
      if (col.fields.find((f) => f.name === name)) return;
      col.fields.add(new Field({ name, required: false, system: false, hidden: false, ...field }));
    }

    addField('sectionName', {
      id: 'text_articleUpdateSuggestions_sectionName',
      type: 'text',
    });
    addField('sectionId', {
      id: 'text_articleUpdateSuggestions_sectionId',
      type: 'text',
      max: 200,
    });
    addField('exists', {
      id: 'bool_articleUpdateSuggestions_exists',
      type: 'bool',
    });
    addField('newSection', {
      id: 'bool_articleUpdateSuggestions_newSection',
      type: 'bool',
    });
    addField('sectionUpdate', {
      id: 'bool_articleUpdateSuggestions_sectionUpdate',
      type: 'bool',
    });
    addField('previousSectionNames', {
      id: 'json_articleUpdateSuggestions_previousSectionNames',
      type: 'json',
      maxSize: 200000,
    });
    addField('overallCoverage', {
      id: 'number_articleUpdateSuggestions_overallCoverage',
      type: 'number',
    });
    addField('unique_title', {
      id: 'text_articleUpdateSuggestions_uniqueTitle',
      type: 'text',
    });
    addField('uniqueId', {
      id: 'text_articleUpdateSuggestions_uniqueId',
      type: 'text',
      max: 500,
    });

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('articleUpdateSuggestions');
    for (const name of [
      'sectionName',
      'sectionId',
      'exists',
      'newSection',
      'sectionUpdate',
      'previousSectionNames',
      'overallCoverage',
      'unique_title',
      'uniqueId',
    ]) {
      const field = col.fields.find((f) => f.name === name);
      if (field) col.fields.removeById(field.id);
    }
    app.save(col);
  },
);
