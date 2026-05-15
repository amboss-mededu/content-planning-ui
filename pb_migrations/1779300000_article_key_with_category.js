/// <reference path="../pb_data/types.d.ts" />

// Re-backfill `articleKey` / `sectionKey` / `recordKey` using the new
// category-aware formula. See `src/lib/data/article-keys.ts` for the
// canonical encoding — the JS below must stay in lock-step.
//
// Why this matters: the prior backfill (1779200000_stable_article_keys.js)
// keyed articles purely on (slug, title). The imported xlsx data has
// 69 same-title pairs in `consolidatedArticles` that differ only by
// `category` (e.g. "Neuroanesthesia" under Cardiac vs Vascular vs Neuro).
// They collapsed into one shared key, so approving one row updated the
// review of all of them. Augmenting the key with `category` splits
// them back into independent review targets.
//
// Re-resolution path for consumer collections: we look up the producer
// row by the LEGACY `articleRecordId` / `sectionRecordId` / `recordId`
// column (still in place as a safety net from the prior migration),
// then copy the producer's freshly-computed key onto the consumer row.
// Existing approvals + assignments survive the rekey.

migrate(
  (app) => {
    function normalize(s) {
      if (!s) return '';
      return String(s)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    function computeArticleKey(slug, articleTitle, articleId, category) {
      const aid = (articleId || '').trim();
      if (aid) return 'upd::' + aid;
      const t = (articleTitle || '').trim();
      const sl = (slug || '').trim();
      if (!t || !sl) return '';
      const cat = (category || '').trim();
      if (cat) {
        return 'new::' + sl + '::' + normalize(cat) + '::' + normalize(t);
      }
      return 'new::' + sl + '::' + normalize(t);
    }

    function computeSectionKey(slug, articleTitle, articleId, sectionName, sectionId, category) {
      const aid = (articleId || '').trim();
      const sid = (sectionId || '').trim();
      if (aid && sid) return 'sec-upd::' + aid + '::' + sid;
      const at = (articleTitle || '').trim();
      const sn = (sectionName || '').trim();
      const sl = (slug || '').trim();
      if (!at || !sn || !sl) return '';
      const cat = (category || '').trim();
      if (cat) {
        return 'sec::' + sl + '::' + normalize(cat) + '::' + normalize(at) + '::' + normalize(sn);
      }
      return 'sec::' + sl + '::' + normalize(at) + '::' + normalize(sn);
    }

    // ---- 1. Re-backfill producer collections --------------------------------

    for (const name of [
      'consolidatedArticles',
      'newArticleSuggestions',
      'articleUpdateSuggestions',
    ]) {
      const rows = app.findAllRecords(name);
      for (const r of rows) {
        const key = computeArticleKey(
          r.get('specialtySlug'),
          r.get('articleTitle'),
          r.get('articleId'),
          // newArticleSuggestions doesn't have a `category` column —
          // r.get() returns '' for missing fields, which the helper
          // falls through to the pre-category formula on.
          r.get('category'),
        );
        if (key && r.get('articleKey') !== key) {
          r.set('articleKey', key);
          app.save(r);
        }
      }
    }

    {
      const rows = app.findAllRecords('consolidatedSections');
      for (const r of rows) {
        const key = computeSectionKey(
          r.get('specialtySlug'),
          r.get('articleTitle'),
          r.get('articleId'),
          r.get('sectionName'),
          r.get('sectionId'),
          r.get('category'),
        );
        if (key && r.get('sectionKey') !== key) {
          r.set('sectionKey', key);
          app.save(r);
        }
      }
    }

    // ---- 2. Rebuild consumer→producer resolution maps -----------------------
    //
    // Per-collection map of PB id → key, used to walk consumer tables
    // and copy the producer's freshly-computed key onto each
    // consumer row whose legacy `articleRecordId`/`sectionRecordId`/
    // `recordId` foreign-key column still resolves.

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

    // ---- 3. Re-backfill articleBacklog --------------------------------------

    {
      const rows = app.findAllRecords('articleBacklog');
      for (const r of rows) {
        const articleRecordId = r.get('articleRecordId');
        const t = r.get('type');
        let key = '';
        if (t === 'update') {
          // update rows: articleRecordId is the CMS articleId directly.
          key = 'upd::' + articleRecordId;
        } else {
          // new rows: articleRecordId points at one of the suggestion
          // tables (preferentially newArticleSuggestions, then
          // articleUpdateSuggestions). Fall through to the
          // consolidatedArticles map last — the source-of-truth swap
          // for the backlog reads from there, so any backlog row whose
          // recordId points at a current consolidatedArticles row
          // should resolve through that lookup.
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

    // ---- 4. Re-backfill articleReviews -------------------------------------

    {
      const rows = app.findAllRecords('articleReviews');
      for (const r of rows) {
        const articleRecordId = r.get('articleRecordId');
        // articleReviews historically pointed at consolidatedArticles
        // PB ids (per the schema comment) but in practice the imported
        // xlsx data has reviews keyed against rows from any of the
        // three article-shaped collections. Try each in turn.
        const key =
          keyByConsolidatedArticle[articleRecordId] ||
          keyByNewSuggestion[articleRecordId] ||
          keyByUpdateSuggestion[articleRecordId] ||
          '';
        if (key && r.get('articleKey') !== key) {
          r.set('articleKey', key);
          app.save(r);
        }
      }
    }

    // ---- 5. Re-backfill sectionReviews -------------------------------------

    {
      const rows = app.findAllRecords('sectionReviews');
      for (const r of rows) {
        const sectionRecordId = r.get('sectionRecordId');
        const key = keyByConsolidatedSection[sectionRecordId] || '';
        if (key && r.get('sectionKey') !== key) {
          r.set('sectionKey', key);
          app.save(r);
        }
      }
    }

    // ---- 6. Re-backfill reviewComments -------------------------------------

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
            keyByConsolidatedArticle[stripped] ||
            keyByNewSuggestion[stripped] ||
            keyByUpdateSuggestion[stripped] ||
            '';
        }
        if (key && r.get('recordKey') !== key) {
          r.set('recordKey', key);
          app.save(r);
        }
      }
    }
  },
  (app) => {
    // Down: revert keys to the pre-category formula. Same algorithm as
    // 1779200000_stable_article_keys.js' up direction, minus the
    // schema changes (those were applied by the prior migration).

    function normalize(s) {
      if (!s) return '';
      return String(s)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    function computeArticleKeyV1(slug, articleTitle, articleId) {
      const aid = (articleId || '').trim();
      if (aid) return 'upd::' + aid;
      const t = (articleTitle || '').trim();
      const sl = (slug || '').trim();
      if (!t || !sl) return '';
      return 'new::' + sl + '::' + normalize(t);
    }

    function computeSectionKeyV1(slug, articleTitle, articleId, sectionName, sectionId) {
      const aid = (articleId || '').trim();
      const sid = (sectionId || '').trim();
      if (aid && sid) return 'sec-upd::' + aid + '::' + sid;
      const at = (articleTitle || '').trim();
      const sn = (sectionName || '').trim();
      const sl = (slug || '').trim();
      if (!at || !sn || !sl) return '';
      return 'sec::' + sl + '::' + normalize(at) + '::' + normalize(sn);
    }

    for (const name of [
      'consolidatedArticles',
      'newArticleSuggestions',
      'articleUpdateSuggestions',
    ]) {
      const rows = app.findAllRecords(name);
      for (const r of rows) {
        const key = computeArticleKeyV1(
          r.get('specialtySlug'),
          r.get('articleTitle'),
          r.get('articleId'),
        );
        if (key && r.get('articleKey') !== key) {
          r.set('articleKey', key);
          app.save(r);
        }
      }
    }

    {
      const rows = app.findAllRecords('consolidatedSections');
      for (const r of rows) {
        const key = computeSectionKeyV1(
          r.get('specialtySlug'),
          r.get('articleTitle'),
          r.get('articleId'),
          r.get('sectionName'),
          r.get('sectionId'),
        );
        if (key && r.get('sectionKey') !== key) {
          r.set('sectionKey', key);
          app.save(r);
        }
      }
    }
    // Consumer collections are intentionally not re-resolved on down —
    // the structure of the consumer→producer link via legacy id columns
    // is unchanged, so the prior migration's resolution still holds.
  },
);
