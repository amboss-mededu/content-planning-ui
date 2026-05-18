/// <reference path="../pb_data/types.d.ts" />

// Re-resolve consumer collections (articleReviews, articleBacklog,
// reviewComments) to point at `newArticleSuggestions` keys instead of
// `consolidatedArticles` keys.
//
// Why: this app's xlsx-imported data treats `newArticleSuggestions` as
// the deduped 2nd-pass output (the list of articles editors actually
// review and approve), while `consolidatedArticles` holds the raw 1st-
// pass per-category list. The earlier migration (1779200000) backfilled
// consumer keys via lookup order
//     newArticleSuggestions → articleUpdateSuggestions → consolidatedArticles
// which was correct, but the follow-up (1779300000) re-resolved
// articleReviews preferentially through `consolidatedArticles`. With
// /consolidation-review + /backlog both reading newArticleSuggestions
// again, that preference points at the wrong collection.
//
// This migration restores the original lookup order, so any review row
// whose legacy `articleRecordId` matches a current newArticleSuggestions
// row gets that row's key. Rows whose `articleRecordId` only resolves
// to a consolidatedArticles row keep that key (rare; harmless — the
// UI just won't show those approvals).

migrate(
  (app) => {
    function buildKeyMap(collectionName, keyField) {
      const out = {};
      const rows = app.findAllRecords(collectionName);
      for (const r of rows) {
        const k = r.get(keyField);
        if (k) out[r.id] = k;
      }
      return out;
    }

    const keyByNewSuggestion = buildKeyMap('newArticleSuggestions', 'articleKey');
    const keyByUpdateSuggestion = buildKeyMap('articleUpdateSuggestions', 'articleKey');
    const keyByConsolidatedArticle = buildKeyMap('consolidatedArticles', 'articleKey');
    const keyByConsolidatedSection = buildKeyMap('consolidatedSections', 'sectionKey');

    // ---- articleReviews ----------------------------------------------------

    {
      const rows = app.findAllRecords('articleReviews');
      for (const r of rows) {
        const articleRecordId = r.get('articleRecordId');
        const key =
          keyByNewSuggestion[articleRecordId] ||
          keyByUpdateSuggestion[articleRecordId] ||
          keyByConsolidatedArticle[articleRecordId] ||
          '';
        if (key && r.get('articleKey') !== key) {
          r.set('articleKey', key);
          app.save(r);
        }
      }
    }

    // ---- articleBacklog ----------------------------------------------------

    {
      const rows = app.findAllRecords('articleBacklog');
      for (const r of rows) {
        const articleRecordId = r.get('articleRecordId');
        const t = r.get('type');
        let key = '';
        if (t === 'update') {
          key = 'upd::' + articleRecordId;
        } else {
          key =
            keyByNewSuggestion[articleRecordId] ||
            keyByUpdateSuggestion[articleRecordId] ||
            keyByConsolidatedArticle[articleRecordId] ||
            '';
        }
        if (key && r.get('articleKey') !== key) {
          r.set('articleKey', key);
          app.save(r);
        }
      }
    }

    // ---- reviewComments ----------------------------------------------------

    {
      const rows = app.findAllRecords('reviewComments');
      for (const r of rows) {
        const recordId = r.get('recordId');
        const kind = r.get('recordKind');
        const stripped = recordId.indexOf('pa:') === 0 ? recordId.slice(3) : recordId;
        let key = '';
        if (kind === 'section') {
          key = keyByConsolidatedSection[stripped] || '';
        } else {
          key =
            keyByNewSuggestion[stripped] ||
            keyByUpdateSuggestion[stripped] ||
            keyByConsolidatedArticle[stripped] ||
            '';
        }
        if (key && r.get('recordKey') !== key) {
          r.set('recordKey', key);
          app.save(r);
        }
      }
    }
  },
  (_app) => {
    // Down is a no-op — the previous migration's resolution is also a
    // valid state, no destructive change to revert.
  },
);
