/// <reference path="../pb_data/types.d.ts" />

// Adds the "pipeline mode" feature + a code/topic-level literature-search
// machine that mirrors the article-level one (1780200000 / 1778453539).
//
//   specialties.pipelineMode (text) — 'full' | 'mapping-only' | 'rag-corpus'.
//     Source of truth for the run mode; empty/absent falls back to the legacy
//     `mappingOnly` boolean at the TS layer. 'rag-corpus' = map against
//     guidelines, then per-topic literature search to build a reference corpus.
//
//   codes.litSearch* — denormalized per-code lit-search status for the mapping
//     sheet column (the durable run state lives in codeLitSearchRuns).
//
//   codeLitSearchRuns — durable per-code literature-search state (clone of
//     articleLitSearchRuns), keyed by the code's PB id.
//   codeLitSources — per-code source list (clone of articleSources), keyed by
//     the code's PB id. Bulk delete-then-insert on each run. NOTE: named
//     `codeLitSources` to avoid colliding with the unrelated `codeSources`
//     registry collection ({slug,name}) from the initial schema.

const CODES_TEXT_FIELDS = [['text_codes_litSearchStatus', 'litSearchStatus']];
const CODES_NUMBER_FIELDS = [
  ['number_codes_litSearchSourceCount', 'litSearchSourceCount'],
  ['number_codes_litSearchedAt', 'litSearchedAt'],
];

migrate(
  (app) => {
    // --- specialties.pipelineMode -----------------------------------------
    const specialties = app.findCollectionByNameOrId('specialties');
    if (!specialties.fields.find((f) => f.name === 'pipelineMode')) {
      specialties.fields.add(
        new Field({
          id: 'text_specialties_pipelineMode',
          type: 'text',
          name: 'pipelineMode',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
        }),
      );
      app.save(specialties);
    }

    // --- codes.litSearch* -------------------------------------------------
    const codes = app.findCollectionByNameOrId('codes');
    let dirty = false;
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
    if (dirty) app.save(codes);

    // --- codeLitSearchRuns ------------------------------------------------
    try {
      app.findCollectionByNameOrId('codeLitSearchRuns');
    } catch (_) {
      app.save(
        new Collection({
          type: 'base',
          name: 'codeLitSearchRuns',
          listRule: "@request.auth.id != ''",
          viewRule: "@request.auth.id != ''",
          createRule:
            "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
          updateRule: "@request.auth.id != ''",
          deleteRule: "@request.auth.id != ''",
          fields: [
            { type: 'text', name: 'specialtySlug', required: true, max: 200 },
            { type: 'text', name: 'codeId', required: true, max: 50 },
            { type: 'text', name: 'code', max: 200 },
            { type: 'text', name: 'runId', max: 50 },
            {
              type: 'select',
              name: 'status',
              required: true,
              maxSelect: 1,
              values: ['running', 'completed', 'failed', 'cancelled'],
            },
            { type: 'number', name: 'startedAt' },
            { type: 'number', name: 'finishedAt' },
            { type: 'text', name: 'errorMessage', max: 2000 },
            { type: 'number', name: 'queryCount' },
            { type: 'number', name: 'candidateCount' },
            { type: 'number', name: 'sourcesCount' },
          ],
          indexes: [
            'CREATE INDEX `idx_codeLitSearchRuns_specialty` ON `codeLitSearchRuns` (`specialtySlug`)',
            'CREATE INDEX `idx_codeLitSearchRuns_code` ON `codeLitSearchRuns` (`specialtySlug`, `codeId`, `startedAt`)',
            'CREATE UNIQUE INDEX `idx_codeLitSearchRuns_running` ON `codeLitSearchRuns` (`specialtySlug`, `codeId`) WHERE `status` = "running"',
          ],
        }),
      );
    }

    // --- codeLitSources ---------------------------------------------------
    try {
      app.findCollectionByNameOrId('codeLitSources');
    } catch (_) {
      app.save(
        new Collection({
          type: 'base',
          name: 'codeLitSources',
          listRule: "@request.auth.id != ''",
          viewRule: "@request.auth.id != ''",
          createRule:
            "@request.auth.id != '' && @collection.specialties.slug ?= @request.body.specialtySlug",
          updateRule: "@request.auth.id != ''",
          deleteRule: "@request.auth.id != ''",
          fields: [
            { type: 'text', name: 'specialtySlug', required: true, max: 200 },
            { type: 'text', name: 'codeId', required: true, max: 50 },
            { type: 'text', name: 'code', max: 200 },
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
            { type: 'bool', name: 'superseded' },
            { type: 'number', name: 'priority' },
            { type: 'text', name: 'originalFilename', max: 300 },
            { type: 'text', name: 'geminiFilename', max: 300 },
            { type: 'text', name: 'uri', max: 1000 },
            { type: 'text', name: 'mimeType', max: 100 },
            { type: 'text', name: 'cortexSourceId', max: 100 },
            {
              type: 'select',
              name: 'reviewStatus',
              maxSelect: 1,
              values: ['approved', 'rejected'],
            },
            { type: 'text', name: 'reviewerEmail', max: 200 },
            { type: 'number', name: 'reviewedAt' },
            { type: 'text', name: 'notes', max: 4000 },
          ],
          indexes: [
            'CREATE INDEX `idx_codeLitSources_specialty` ON `codeLitSources` (`specialtySlug`)',
            'CREATE INDEX `idx_codeLitSources_code` ON `codeLitSources` (`specialtySlug`, `codeId`)',
          ],
        }),
      );
    }
  },
  (app) => {
    // Drop the new collections first, then remove the added fields.
    for (const name of ['codeLitSources', 'codeLitSearchRuns']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* not present — fine */
      }
    }

    const specialties = app.findCollectionByNameOrId('specialties');
    const pm = specialties.fields.find((f) => f.name === 'pipelineMode');
    if (pm) {
      specialties.fields.removeById(pm.id);
      app.save(specialties);
    }

    const codes = app.findCollectionByNameOrId('codes');
    let dirty = false;
    for (const name of [
      ...CODES_TEXT_FIELDS.map(([, n]) => n),
      ...CODES_NUMBER_FIELDS.map(([, n]) => n),
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
