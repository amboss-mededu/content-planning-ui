/// <reference path="../pb_data/types.d.ts" />

// articleSources — per-article source list. Schema mirrors the n8n
// literature-search workflow output (Search topic workflow.json) so the
// future "Search sources" action can insert rows directly. Many rows
// per parent article (keyed by articleRecordId = newArticleSuggestions
// PB id).

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'articleSources',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule:
          "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'articleRecordId', required: true, max: 50 },
          { type: 'text', name: 'ribosomId', max: 100 },
          { type: 'text', name: 'title', required: true, max: 500 },
          { type: 'text', name: 'doi', max: 200 },
          { type: 'text', name: 'url', max: 1000 },
          { type: 'text', name: 'journal', max: 300 },
          { type: 'text', name: 'journalNlm', max: 100 },
          {
            type: 'select',
            name: 'sourceType',
            maxSelect: 1,
            values: [
              'guideline',
              'systematic_review',
              'clinical_review',
              'meta_analysis',
              'case_report',
              'vet_content',
              'non_english',
              'other',
            ],
          },
          {
            type: 'select',
            name: 'predatoryJournalRisk',
            maxSelect: 1,
            values: ['none', 'low', 'medium', 'high', 'predatory'],
          },
          { type: 'number', name: 'totalCitations' },
          { type: 'number', name: 'impactFactor' },
          { type: 'number', name: 'rank' },
          { type: 'text', name: 'subtopics', max: 1000 },
          { type: 'text', name: 'llmSummary', max: 4000 },
          { type: 'text', name: 'justification', max: 2000 },
          { type: 'bool', name: 'useFlag' },
          { type: 'bool', name: 'superseded' },
          { type: 'number', name: 'priority' },
          { type: 'text', name: 'originalFilename', max: 300 },
          { type: 'text', name: 'geminiFilename', max: 300 },
          { type: 'text', name: 'uri', max: 1000 },
          { type: 'text', name: 'mimeType', max: 100 },
        ],
        indexes: [
          'CREATE INDEX `idx_articleSources_specialty` ON `articleSources` (`specialtySlug`)',
          'CREATE INDEX `idx_articleSources_article` ON `articleSources` (`specialtySlug`, `articleRecordId`)',
        ],
      }),
    );
  },
  (app) => {
    try {
      const existing = app.findCollectionByNameOrId('articleSources');
      app.delete(existing);
    } catch (_) {
      /* not present — fine */
    }
  },
);
