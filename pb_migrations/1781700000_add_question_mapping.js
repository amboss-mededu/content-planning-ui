/// <reference path="../pb_data/types.d.ts" />

// Adds the "question mapping" track: curriculum-mapping specialties map each
// code against AMBOSS Qbank questions (via the `search_questions` MCP tool), in
// addition to the existing article track. Mirrors the `articlesWhereCoverageIs`
// + derived-count pattern.
//
//   codes.questionsWhereCoverageIs (json) — array of matched questions, each
//     { questionId (EID), questionStem, studyObjectives, learningObjective,
//       competency, system, difficulty }. Unbounded (maxSize:0) — stems are
//     free text.
//   codes.questionCount (number) — derived count for the table column, so the
//     sheet renders without shipping the JSON (parallel to coverageArticleCount).
//
// Additive only — existing rows (never question-mapped) default to empty/0.

migrate(
  (app) => {
    const codes = app.findCollectionByNameOrId('codes');
    let dirty = false;

    if (!codes.fields.find((f) => f.name === 'questionsWhereCoverageIs')) {
      codes.fields.add(
        new Field({
          id: 'json_codes_questionsWhereCoverageIs',
          type: 'json',
          name: 'questionsWhereCoverageIs',
          required: false,
          system: false,
          hidden: false,
          presentable: false,
          maxSize: 0,
        }),
      );
      dirty = true;
    }

    if (!codes.fields.find((f) => f.name === 'questionCount')) {
      codes.fields.add(
        new Field({
          id: 'number_codes_questionCount',
          type: 'number',
          name: 'questionCount',
          required: false,
          system: false,
          hidden: false,
        }),
      );
      dirty = true;
    }

    if (dirty) app.save(codes);
  },
  (app) => {
    const codes = app.findCollectionByNameOrId('codes');
    let dirty = false;
    for (const name of ['questionsWhereCoverageIs', 'questionCount']) {
      const f = codes.fields.find((x) => x.name === name);
      if (f) {
        codes.fields.removeById(f.id);
        dirty = true;
      }
    }
    if (dirty) app.save(codes);
  },
);
