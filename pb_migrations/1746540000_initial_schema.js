/// <reference path="../pb_data/types.d.ts" />

// Initial PocketBase schema — replaces the Convex schema in convex/schema/*.
//
// Mappings vs. Convex:
//   - v.string() / v.optional(v.string())  -> text
//   - v.number() / v.optional(v.number())  -> number
//   - v.boolean()                          -> bool
//   - v.id('users')                        -> relation -> users
//   - v.array(...) of typed records        -> json (validation stays in app code)
//   - jsonBlob / jsonBlobString            -> json
//   - Convex `_creationTime`               -> built-in `created` autodate
//   - Convex .index('name', [fields...])   -> SQL CREATE INDEX statement
//
// Auth replacement:
//   - convex/authTables -> built-in PocketBase auth collection ('users')
//   - Email/password disabled; sign-in is Google OAuth only.
//   - Domain restriction enforced server-side in pb_hooks/main.pb.js.
//   - Google OAuth credentials are NOT in this file; configure via
//     PocketBase admin UI on first start or via a setup script that uses
//     the admin SDK + env vars.
//
// Access rules: every data collection requires an authenticated request
// (`@request.auth.id != ''`). userApiKeys is row-scoped to the owning
// user. The 'users' collection only lets a user see / edit their own row.

migrate(
  (app) => {
    // -------------------------------------------------------------------
    // users (auth)  — replaces authTables from @convex-dev/auth
    // -------------------------------------------------------------------
    const users = new Collection({
      type: 'auth',
      name: 'users',
      listRule: 'id = @request.auth.id',
      viewRule: 'id = @request.auth.id',
      createRule: null, // signup happens via OAuth flow only
      updateRule: 'id = @request.auth.id',
      deleteRule: null,
      passwordAuth: { enabled: false, identityFields: ['email'] },
      otp: { enabled: false },
      oauth2: {
        enabled: true,
        // Provider credentials live outside the migration (admin UI / env-var
        // setup script). Keeping secrets out of the committed migration.
        providers: [{ name: 'google' }],
      },
      fields: [
        { type: 'text', name: 'name', max: 200 },
        { type: 'url', name: 'avatarUrl' },
      ],
    });
    app.save(users);
    const usersId = app.findCollectionByNameOrId('users').id;

    // -------------------------------------------------------------------
    // specialties
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'specialties',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'slug', required: true, max: 200 },
          { type: 'text', name: 'name', required: true, max: 500 },
          { type: 'text', name: 'source', required: true, max: 100 },
          { type: 'text', name: 'sheetId', max: 200 },
          { type: 'text', name: 'xlsxPath', max: 500 },
          { type: 'number', name: 'lastSeededAt' },
          { type: 'text', name: 'milestones' },
          { type: 'text', name: 'region', max: 100 },
          { type: 'text', name: 'language', max: 100 },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_specialties_slug` ON `specialties` (`slug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // codes  — editor-facing
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'codes',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'specialty', max: 500 },
          { type: 'text', name: 'source', max: 100 },
          { type: 'text', name: 'code', required: true, max: 200 },
          { type: 'text', name: 'category', max: 200 },
          { type: 'text', name: 'consolidationCategory', max: 200 },
          { type: 'text', name: 'description' },
          { type: 'bool', name: 'isInAMBOSS' },
          // articlesWhereCoverageIs: array of { articleTitle?, articleId?, sections? }
          { type: 'json', name: 'articlesWhereCoverageIs' },
          { type: 'text', name: 'notes' },
          { type: 'text', name: 'gaps' },
          { type: 'text', name: 'coverageLevel', max: 100 },
          { type: 'number', name: 'depthOfCoverage' },
          // existingArticleUpdates: array of sectionUpdateShape
          { type: 'json', name: 'existingArticleUpdates' },
          // newArticlesNeeded: array of newArticleShape
          { type: 'json', name: 'newArticlesNeeded' },
          { type: 'text', name: 'improvements' },
        ],
        indexes: [
          'CREATE INDEX `idx_codes_specialty` ON `codes` (`specialtySlug`)',
          'CREATE INDEX `idx_codes_specialty_code` ON `codes` (`specialtySlug`, `code`)',
          'CREATE INDEX `idx_codes_specialty_category` ON `codes` (`specialtySlug`, `category`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // codeCategories
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'codeCategories',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'codeCategory', max: 200 },
          { type: 'text', name: 'source', max: 100 },
          { type: 'bool', name: 'areAllCodesRun' },
          { type: 'bool', name: 'isConsolidated' },
          { type: 'text', name: 'description' },
          { type: 'number', name: 'numCodes' },
          { type: 'number', name: 'totalArticleCodes' },
          { type: 'number', name: 'totalSectionCodes' },
          { type: 'text', name: 'codesToIgnore' },
          { type: 'number', name: 'numIncludedCodes' },
          { type: 'json', name: 'includedArticleCodes' },
          { type: 'number', name: 'numIncludedArticleCodes' },
          { type: 'json', name: 'excludedArticleCodes' },
          { type: 'number', name: 'numExcludedArticleCodes' },
          { type: 'json', name: 'includedSectionCodes' },
          { type: 'number', name: 'numIncludedSectionCodes' },
          { type: 'json', name: 'excludedSectionCodes' },
          { type: 'number', name: 'numExcludedSectionCodes' },
          { type: 'json', name: 'totallyIgnoredCodes' },
          { type: 'number', name: 'numTotallyIgnoredCodes' },
        ],
        indexes: [
          'CREATE INDEX `idx_codeCategories_specialty` ON `codeCategories` (`specialtySlug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // mappingsInFlight  — volatile per-run state
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'mappingsInFlight',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'code', required: true, max: 200 },
          { type: 'text', name: 'runId', required: true, max: 200 },
          { type: 'number', name: 'startedAt', required: true },
        ],
        indexes: [
          'CREATE INDEX `idx_mappingsInFlight_specialty` ON `mappingsInFlight` (`specialtySlug`)',
          'CREATE INDEX `idx_mappingsInFlight_specialty_code` ON `mappingsInFlight` (`specialtySlug`, `code`)',
          'CREATE INDEX `idx_mappingsInFlight_run` ON `mappingsInFlight` (`runId`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // consolidatedArticles
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'consolidatedArticles',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'articleTitle' },
          { type: 'text', name: 'articleType', max: 200 },
          { type: 'text', name: 'specialtyName', max: 500 },
          { type: 'text', name: 'category', max: 200 },
          { type: 'text', name: 'articleId', max: 200 },
          { type: 'number', name: 'numCodes' },
          { type: 'json', name: 'codes' },
          { type: 'json', name: 'previousArticleTitleSuggestions' },
          { type: 'number', name: 'overallCoverage' },
          { type: 'number', name: 'overallImportance' },
          { type: 'text', name: 'justification' },
        ],
        indexes: [
          'CREATE INDEX `idx_consolidatedArticles_specialty` ON `consolidatedArticles` (`specialtySlug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // newArticleSuggestions  — articleSuggestionFields shape
    // -------------------------------------------------------------------
    const articleSuggestionFields = [
      { type: 'text', name: 'specialtySlug', required: true, max: 200 },
      { type: 'text', name: 'assignedEditor', max: 500 },
      { type: 'text', name: 'editorInTheLoopReview', max: 500 },
      { type: 'bool', name: 'newArticle' },
      { type: 'bool', name: 'articleMaintenance' },
      { type: 'text', name: 'articleTitle' },
      { type: 'text', name: 'alternateTitles' },
      { type: 'text', name: 'articleProgress', max: 200 },
      { type: 'text', name: 'articleType', max: 200 },
      { type: 'text', name: 'specialtyName', max: 500 },
      { type: 'text', name: 'articleId', max: 200 },
      { type: 'json', name: 'codes' },
      { type: 'text', name: 'literatureSearchTerms' },
      { type: 'text', name: 'sections' },
      { type: 'json', name: 'previousArticleTitleSuggestions' },
      { type: 'json', name: 'previousConsolidationIndexes' },
      { type: 'text', name: 'existingAmbossCoverage' },
      { type: 'number', name: 'overallImportance' },
      { type: 'text', name: 'justification' },
      { type: 'bool', name: 'isSearched' },
      { type: 'text', name: 'llmSearchTerms' },
      { type: 'text', name: 'verdict', max: 200 },
      // NB: Convex schema has both `justification` and `justifcation` (typo
      // preserved across rows). Mirroring 1:1 to keep app code working.
      { type: 'text', name: 'justifcation' },
      { type: 'bool', name: 'isSufficientlyCovered' },
      { type: 'bool', name: 'areAllSourcesFetched' },
    ];

    app.save(
      new Collection({
        type: 'base',
        name: 'newArticleSuggestions',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: articleSuggestionFields,
        indexes: [
          'CREATE INDEX `idx_newArticleSuggestions_specialty` ON `newArticleSuggestions` (`specialtySlug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // articleUpdateSuggestions  — same shape as newArticleSuggestions
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'articleUpdateSuggestions',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: articleSuggestionFields,
        indexes: [
          'CREATE INDEX `idx_articleUpdateSuggestions_specialty` ON `articleUpdateSuggestions` (`specialtySlug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // consolidatedSections
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'consolidatedSections',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'assignedEditor', max: 500 },
          { type: 'text', name: 'editorInTheLoopReview', max: 500 },
          { type: 'text', name: 'articleTitle' },
          { type: 'text', name: 'articleType', max: 200 },
          { type: 'text', name: 'articleId', max: 200 },
          { type: 'text', name: 'sectionName' },
          { type: 'bool', name: 'newSection' },
          { type: 'bool', name: 'sectionUpdate' },
          { type: 'text', name: 'newPhrase' },
          { type: 'text', name: 'specialtyName', max: 500 },
          { type: 'text', name: 'category', max: 200 },
          { type: 'text', name: 'unique_title' },
          { type: 'text', name: 'uniqueId', max: 200 },
          { type: 'number', name: 'numCodes' },
          { type: 'json', name: 'codes' },
          { type: 'json', name: 'previousSectionNames' },
          { type: 'bool', name: 'exists' },
          { type: 'text', name: 'sectionId', max: 200 },
          { type: 'number', name: 'overallCoverage' },
          { type: 'number', name: 'overallImportance' },
          { type: 'text', name: 'justification' },
          { type: 'bool', name: 'isSearched' },
          { type: 'text', name: 'llmSearchTerms' },
          { type: 'text', name: 'verdict', max: 200 },
          { type: 'text', name: 'justifcation' },
          { type: 'bool', name: 'isSufficientlyCovered' },
          { type: 'bool', name: 'areAllSourcesFetched' },
        ],
        indexes: [
          'CREATE INDEX `idx_consolidatedSections_specialty` ON `consolidatedSections` (`specialtySlug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // Ontology mirror tables (read-only): icd10Codes, hcupCodes,
    // abimCodes, orphaCodes
    // -------------------------------------------------------------------
    const ontologyCols = [
      { name: 'icd10Codes', codeMax: 50, descMax: 0 },
      { name: 'hcupCodes', codeMax: 50, descMax: 0 },
      { name: 'abimCodes', codeMax: 50, descMax: 0 },
      { name: 'orphaCodes', codeMax: 50, descMax: 0 },
    ];
    for (const { name } of ontologyCols) {
      app.save(
        new Collection({
          type: 'base',
          name,
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
            'CREATE INDEX `idx_' + name + '_code` ON `' + name + '` (`code`)',
          ],
        }),
      );
    }

    // -------------------------------------------------------------------
    // ambossArticles  — local mirror of AMBOSS library article IDs
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'ambossArticles',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'articleId', required: true, max: 200 },
          { type: 'text', name: 'title', required: true },
          { type: 'text', name: 'contentBase' },
          { type: 'number', name: 'updatedAt', required: true },
        ],
        indexes: [
          'CREATE INDEX `idx_ambossArticles_articleId` ON `ambossArticles` (`articleId`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // ambossSections
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'ambossSections',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'sectionId', required: true, max: 200 },
          { type: 'text', name: 'articleId', required: true, max: 200 },
          { type: 'text', name: 'title', required: true },
          { type: 'number', name: 'updatedAt', required: true },
        ],
        indexes: [
          'CREATE INDEX `idx_ambossSections_sectionId` ON `ambossSections` (`sectionId`)',
          'CREATE INDEX `idx_ambossSections_article` ON `ambossSections` (`articleId`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // codeSources
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'codeSources',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'slug', required: true, max: 200 },
          { type: 'text', name: 'name', required: true, max: 500 },
          { type: 'number', name: 'createdAt', required: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_codeSources_slug` ON `codeSources` (`slug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // milestoneSources
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'milestoneSources',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'slug', required: true, max: 200 },
          { type: 'text', name: 'name', required: true, max: 500 },
          { type: 'number', name: 'createdAt', required: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_milestoneSources_slug` ON `milestoneSources` (`slug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // pipelineRuns
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'pipelineRuns',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'status', required: true, max: 50 },
          { type: 'text', name: 'workflowRunId', max: 200 },
          { type: 'number', name: 'startedAt', required: true },
          { type: 'number', name: 'updatedAt', required: true },
          { type: 'number', name: 'finishedAt' },
          { type: 'text', name: 'error' },
          // contentOutlineUrls: array of { source, url }
          { type: 'json', name: 'contentOutlineUrls' },
          { type: 'text', name: 'identifyModulesInstructions' },
          { type: 'text', name: 'extractCodesInstructions' },
          { type: 'text', name: 'milestonesInstructions' },
          { type: 'text', name: 'mappingInstructions' },
          { type: 'bool', name: 'mappingCheckIds' },
          // mappingFilter: { categories?: string[], codes?: string[] }
          { type: 'json', name: 'mappingFilter' },
          {
            type: 'relation',
            name: 'createdByUserId',
            collectionId: usersId,
            maxSelect: 1,
            cascadeDelete: false,
          },
        ],
        indexes: [
          'CREATE INDEX `idx_pipelineRuns_specialty` ON `pipelineRuns` (`specialtySlug`)',
          'CREATE INDEX `idx_pipelineRuns_specialty_started` ON `pipelineRuns` (`specialtySlug`, `startedAt`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // pipelineStages
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'pipelineStages',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'runId', required: true, max: 200 },
          { type: 'text', name: 'stage', required: true, max: 100 },
          { type: 'text', name: 'status', required: true, max: 50 },
          { type: 'text', name: 'workflowRunId', max: 200 },
          { type: 'number', name: 'startedAt' },
          { type: 'number', name: 'finishedAt' },
          { type: 'number', name: 'approvedAt' },
          { type: 'text', name: 'approvedBy', max: 200 },
          { type: 'json', name: 'outputSummary' },
          { type: 'json', name: 'draftPayload' },
          { type: 'text', name: 'errorMessage' },
        ],
        indexes: [
          'CREATE INDEX `idx_pipelineStages_run` ON `pipelineStages` (`runId`)',
          'CREATE INDEX `idx_pipelineStages_run_stage` ON `pipelineStages` (`runId`, `stage`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // pipelineEvents
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'pipelineEvents',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'runId', required: true, max: 200 },
          { type: 'text', name: 'stage', required: true, max: 100 },
          { type: 'text', name: 'level', required: true, max: 50 },
          { type: 'text', name: 'message', required: true },
          { type: 'json', name: 'metrics' },
          { type: 'number', name: 'createdAt', required: true },
        ],
        indexes: [
          'CREATE INDEX `idx_pipelineEvents_run` ON `pipelineEvents` (`runId`)',
          'CREATE INDEX `idx_pipelineEvents_run_stage_created` ON `pipelineEvents` (`runId`, `stage`, `createdAt`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // extractedCodes
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'extractedCodes',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'runId', required: true, max: 200 },
          { type: 'text', name: 'specialtySlug', required: true, max: 200 },
          { type: 'text', name: 'code', required: true, max: 200 },
          { type: 'text', name: 'category', max: 200 },
          { type: 'text', name: 'consolidationCategory', max: 200 },
          { type: 'text', name: 'description' },
          { type: 'text', name: 'source', max: 100 },
          { type: 'json', name: 'metadata' },
          { type: 'number', name: 'createdAt', required: true },
        ],
        indexes: [
          'CREATE INDEX `idx_extractedCodes_run` ON `extractedCodes` (`runId`)',
          'CREATE INDEX `idx_extractedCodes_specialty` ON `extractedCodes` (`specialtySlug`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // userApiKeys  — per-user provider API keys
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'userApiKeys',
        // Row-scoped: a user can only see / edit their own keys.
        listRule: 'userId = @request.auth.id',
        viewRule: 'userId = @request.auth.id',
        createRule: 'userId = @request.auth.id',
        updateRule: 'userId = @request.auth.id',
        deleteRule: 'userId = @request.auth.id',
        fields: [
          {
            type: 'relation',
            name: 'userId',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
            cascadeDelete: true,
          },
          { type: 'text', name: 'googleApiKey' },
          { type: 'text', name: 'anthropicApiKey' },
          { type: 'text', name: 'openaiApiKey' },
          { type: 'number', name: 'googleTestedAt' },
          { type: 'select', name: 'googleTestStatus', maxSelect: 1, values: ['ok', 'failed'] },
          { type: 'number', name: 'anthropicTestedAt' },
          { type: 'select', name: 'anthropicTestStatus', maxSelect: 1, values: ['ok', 'failed'] },
          { type: 'number', name: 'openaiTestedAt' },
          { type: 'select', name: 'openaiTestStatus', maxSelect: 1, values: ['ok', 'failed'] },
          { type: 'number', name: 'updatedAt', required: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_userApiKeys_userId` ON `userApiKeys` (`userId`)',
        ],
      }),
    );

    // -------------------------------------------------------------------
    // otpRateLimit  — kept for parity; PocketBase auth has its own rate
    // limiting, so this is unused with OAuth. Will be deleted in the
    // cleanup PR if confirmed unreferenced.
    // -------------------------------------------------------------------
    app.save(
      new Collection({
        type: 'base',
        name: 'otpRateLimit',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { type: 'text', name: 'email', required: true, max: 320 },
          { type: 'number', name: 'windowStart', required: true },
          { type: 'number', name: 'count', required: true },
        ],
        indexes: [
          'CREATE INDEX `idx_otpRateLimit_email` ON `otpRateLimit` (`email`)',
        ],
      }),
    );
  },
  (app) => {
    // Down: drop in reverse-dependency order. relation → users last.
    const names = [
      'otpRateLimit',
      'userApiKeys',
      'extractedCodes',
      'pipelineEvents',
      'pipelineStages',
      'pipelineRuns',
      'milestoneSources',
      'codeSources',
      'ambossSections',
      'ambossArticles',
      'orphaCodes',
      'abimCodes',
      'hcupCodes',
      'icd10Codes',
      'consolidatedSections',
      'articleUpdateSuggestions',
      'newArticleSuggestions',
      'consolidatedArticles',
      'mappingsInFlight',
      'codeCategories',
      'codes',
      'specialties',
      'users',
    ];
    for (const name of names) {
      try {
        const col = app.findCollectionByNameOrId(name);
        app.delete(col);
      } catch (_) {
        /* not present — ignore */
      }
    }
  },
);
