/// <reference path="../pb_data/types.d.ts" />

// articleWritingRuns + articleDrafts — per-article LLM drafting state.
//
// `articleWritingRuns` is the run-tracker: one row per drafting attempt
// for a backlog article, mirrors the `pipelineRuns` shape but scoped to
// a single article rather than a whole specialty. Status transitions:
//   queued → running → completed | failed | cancelled
//
// `articleDrafts` is the per-pass output table: one row per (run, pass)
// holding the LLM output, usage, and timestamps. Six passes per run
// (primary, secondary, proofreader, style, html, copy). Mirrors the n8n
// editorial flow ported in `src/lib/workflows/writing/`.

migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'articleWritingRuns',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'articleRecordId', required: true, max: 50 },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: ['queued', 'running', 'completed', 'failed', 'cancelled'],
          },
          { type: 'text', name: 'currentPass', max: 40 },
          { type: 'number', name: 'startedAt' },
          { type: 'number', name: 'finishedAt' },
          { type: 'text', name: 'errorMessage', max: 2000 },
          { type: 'text', name: 'requestedByEmail', max: 320 },
          { type: 'text', name: 'language', max: 40 },
          { type: 'text', name: 'articleLength', max: 40 },
          { type: 'bool', name: 'useTextBubbles' },
          { type: 'text', name: 'modelProvider', max: 40 },
          { type: 'text', name: 'modelId', max: 80 },
          { type: 'text', name: 'modelReasoning', max: 20 },
        ],
        indexes: [
          'CREATE INDEX `idx_articleWritingRuns_specialty` ON `articleWritingRuns` (`specialtySlug`)',
          'CREATE INDEX `idx_articleWritingRuns_article` ON `articleWritingRuns` (`specialtySlug`, `articleRecordId`)',
        ],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'articleDrafts',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'runId', required: true, max: 50 },
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'articleRecordId', required: true, max: 50 },
          {
            type: 'select',
            name: 'pass',
            required: true,
            maxSelect: 1,
            values: ['primary', 'secondary', 'proofreader', 'style', 'html', 'copy'],
          },
          {
            type: 'select',
            name: 'status',
            required: true,
            maxSelect: 1,
            values: ['running', 'completed', 'failed', 'skipped'],
          },
          { type: 'editor', name: 'output' },
          { type: 'number', name: 'startedAt' },
          { type: 'number', name: 'finishedAt' },
          { type: 'text', name: 'errorMessage', max: 2000 },
          { type: 'number', name: 'inputTokens' },
          { type: 'number', name: 'outputTokens' },
          { type: 'number', name: 'reasoningTokens' },
          { type: 'number', name: 'costUsd' },
          { type: 'text', name: 'modelId', max: 80 },
        ],
        indexes: [
          'CREATE INDEX `idx_articleDrafts_run` ON `articleDrafts` (`runId`)',
          'CREATE INDEX `idx_articleDrafts_article` ON `articleDrafts` (`specialtySlug`, `articleRecordId`)',
          'CREATE UNIQUE INDEX `idx_articleDrafts_run_pass` ON `articleDrafts` (`runId`, `pass`)',
        ],
      }),
    );
  },
  (app) => {
    for (const name of ['articleDrafts', 'articleWritingRuns']) {
      try {
        const existing = app.findCollectionByNameOrId(name);
        app.delete(existing);
      } catch (_) {
        /* not present — fine */
      }
    }
  },
);
