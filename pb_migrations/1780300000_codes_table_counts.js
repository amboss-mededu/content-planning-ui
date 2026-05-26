/// <reference path="../pb_data/types.d.ts" />

// Store lean table counts on codes so the mapping table can render without
// shipping the large mapping JSON blobs in every row.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('codes');

    function addNumberField(name, id) {
      if (col.fields.find((f) => f.name === name)) return;
      col.fields.add(
        new Field({
          id,
          type: 'number',
          name,
          required: false,
          system: false,
          hidden: false,
        }),
      );
    }

    addNumberField('coverageArticleCount', 'number_codes_coverageArticleCount');
    addNumberField('coverageSectionCount', 'number_codes_coverageSectionCount');
    addNumberField('existingArticleUpdateCount', 'number_codes_existingArticleUpdateCount');
    addNumberField('newArticleSuggestionCount', 'number_codes_newArticleSuggestionCount');

    app.save(col);

    function countSections(coverage) {
      if (!Array.isArray(coverage)) return 0;
      let total = 0;
      for (const item of coverage) {
        const sections = item && item.sections;
        if (Array.isArray(sections)) total += sections.length;
        else if (sections && typeof sections === 'object') {
          total += Object.keys(sections).length;
        }
      }
      return total;
    }

    for (const row of app.findAllRecords('codes')) {
      const coverage = row.get('articlesWhereCoverageIs');
      const updates = row.get('existingArticleUpdates');
      const newArticles = row.get('newArticlesNeeded');
      row.set('coverageArticleCount', Array.isArray(coverage) ? coverage.length : 0);
      row.set('coverageSectionCount', countSections(coverage));
      row.set('existingArticleUpdateCount', Array.isArray(updates) ? updates.length : 0);
      row.set('newArticleSuggestionCount', Array.isArray(newArticles) ? newArticles.length : 0);
      app.save(row);
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('codes');
    for (const name of [
      'coverageArticleCount',
      'coverageSectionCount',
      'existingArticleUpdateCount',
      'newArticleSuggestionCount',
    ]) {
      const field = col.fields.find((f) => f.name === name);
      if (field) col.fields.removeById(field.id);
    }
    app.save(col);
  },
);
