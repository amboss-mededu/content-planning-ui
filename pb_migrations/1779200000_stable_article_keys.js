/// <reference path="../pb_data/types.d.ts" />

// Stable, content-derived article and section keys.
//
// Adds a deterministic `articleKey` / `sectionKey` / `recordKey` field to
// every collection that participates in the consolidation → review →
// backlog → comments chain, and backfills the value for existing rows.
// See `src/lib/data/article-keys.ts` for the canonical encoding and the
// rationale. The JS below must keep its `normalize()` and key-compute
// logic in lock-step with that module — any drift will misalign producers
// vs. consumers across the chain.
//
// Backfill semantics:
//   - Producer collections (consolidatedArticles, newArticleSuggestions,
//     articleUpdateSuggestions, consolidatedSections) compute their key
//     from the row's own content.
//   - Consumer collections (articleBacklog, articleReviews, sectionReviews,
//     reviewComments) resolve their existing `articleRecordId` /
//     `sectionRecordId` / `recordId` foreign key to a producer row, copy
//     the producer's key, and store it locally. Zombies (foreign id no
//     longer resolves) are left with an empty key — the UI filters them
//     out, and a future cleanup script can prune them once the dust
//     settles.
//
// Old foreign-key columns are intentionally NOT dropped here. They stay
// in place for one release as a safety net; a follow-up migration will
// remove them once the new path has been exercised in production.

migrate(
  (app) => {
    // ---- normalize + key-compute (mirror of src/lib/data/article-keys.ts) ----

    function normalize(s) {
      if (!s) return '';
      return String(s)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    function computeArticleKey(slug, articleTitle, articleId) {
      const aid = (articleId || '').trim();
      if (aid) return 'upd::' + aid;
      const t = (articleTitle || '').trim();
      const sl = (slug || '').trim();
      if (!t || !sl) return '';
      return 'new::' + sl + '::' + normalize(t);
    }

    function computeSectionKey(slug, articleTitle, articleId, sectionName, sectionId) {
      const aid = (articleId || '').trim();
      const sid = (sectionId || '').trim();
      if (aid && sid) return 'sec-upd::' + aid + '::' + sid;
      const at = (articleTitle || '').trim();
      const sn = (sectionName || '').trim();
      const sl = (slug || '').trim();
      if (!at || !sn || !sl) return '';
      return 'sec::' + sl + '::' + normalize(at) + '::' + normalize(sn);
    }

    // ---- field-adder helpers ------------------------------------------------

    function addTextField(collectionName, fieldName, fieldId) {
      const col = app.findCollectionByNameOrId(collectionName);
      if (col.fields.find((f) => f.name === fieldName)) return col;
      col.fields.add(
        new Field({
          hidden: false,
          id: fieldId,
          name: fieldName,
          max: 400,
          presentable: false,
          required: false,
          system: false,
          type: 'text',
        }),
      );
      app.save(col);
      return app.findCollectionByNameOrId(collectionName);
    }

    function addIndex(collectionName, indexSql) {
      const col = app.findCollectionByNameOrId(collectionName);
      if (col.indexes.find((idx) => idx === indexSql)) return;
      col.indexes.push(indexSql);
      app.save(col);
    }

    // ---- 1. Add new columns to producer collections + backfill --------------

    for (const name of [
      'consolidatedArticles',
      'newArticleSuggestions',
      'articleUpdateSuggestions',
    ]) {
      addTextField(name, 'articleKey', 'text_articleKey_' + name);
      addIndex(
        name,
        'CREATE INDEX `idx_' + name + '_articleKey` ON `' + name + '` (`articleKey`)',
      );
      const rows = app.findAllRecords(name);
      for (const r of rows) {
        const key = computeArticleKey(
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

    addTextField('consolidatedSections', 'sectionKey', 'text_sectionKey_consolidatedSections');
    addIndex(
      'consolidatedSections',
      'CREATE INDEX `idx_consolidatedSections_sectionKey` ON `consolidatedSections` (`sectionKey`)',
    );
    {
      const rows = app.findAllRecords('consolidatedSections');
      for (const r of rows) {
        const key = computeSectionKey(
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

    // ---- 2. Build resolution maps for consumer backfills --------------------
    //
    // For `articleBacklog` we resolve articleRecordId → key by looking
    // up the matching producer row (preferring newArticleSuggestions,
    // then articleUpdateSuggestions). For `articleReviews` we look up
    // in consolidatedArticles. For `sectionReviews` and the section-
    // kind `reviewComments`, we look up in consolidatedSections. We
    // build per-PB-id maps once to avoid N-per-consumer queries.

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

    // ---- 3. Backfill articleBacklog -----------------------------------------

    addTextField('articleBacklog', 'articleKey', 'text_articleKey_articleBacklog');
    addIndex(
      'articleBacklog',
      'CREATE INDEX `idx_articleBacklog_articleKey` ON `articleBacklog` (`articleKey`)',
    );
    {
      const rows = app.findAllRecords('articleBacklog');
      for (const r of rows) {
        const articleRecordId = r.get('articleRecordId');
        const t = r.get('type');
        let key = '';
        if (t === 'update') {
          // type='update' rows store the CMS articleId directly in
          // articleRecordId (per the existing schema comment), so we can
          // synthesize the key without going through a producer row.
          key = 'upd::' + articleRecordId;
        } else {
          // type='new' (or unset, treated as 'new'): articleRecordId
          // points at a newArticleSuggestions PB id.
          key =
            keyByNewSuggestion[articleRecordId] ||
            keyByUpdateSuggestion[articleRecordId] ||
            '';
        }
        if (key && r.get('articleKey') !== key) {
          r.set('articleKey', key);
          app.save(r);
        }
      }
    }

    // ---- 4. Backfill articleReviews ----------------------------------------

    addTextField('articleReviews', 'articleKey', 'text_articleKey_articleReviews');
    addIndex(
      'articleReviews',
      'CREATE INDEX `idx_articleReviews_articleKey` ON `articleReviews` (`articleKey`)',
    );
    {
      const rows = app.findAllRecords('articleReviews');
      for (const r of rows) {
        const articleRecordId = r.get('articleRecordId');
        const key = keyByConsolidatedArticle[articleRecordId] || '';
        if (key && r.get('articleKey') !== key) {
          r.set('articleKey', key);
          app.save(r);
        }
      }
    }

    // ---- 5. Backfill sectionReviews ----------------------------------------

    addTextField('sectionReviews', 'sectionKey', 'text_sectionKey_sectionReviews');
    addIndex(
      'sectionReviews',
      'CREATE INDEX `idx_sectionReviews_sectionKey` ON `sectionReviews` (`sectionKey`)',
    );
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

    // ---- 6. Backfill reviewComments ----------------------------------------

    addTextField('reviewComments', 'recordKey', 'text_recordKey_reviewComments');
    addIndex(
      'reviewComments',
      'CREATE INDEX `idx_reviewComments_recordKey` ON `reviewComments` (`recordKey`)',
    );
    {
      const rows = app.findAllRecords('reviewComments');
      for (const r of rows) {
        const recordId = r.get('recordId');
        const kind = r.get('recordKind');
        // Section comments may use a `pa:` prefix on parent-article ids
        // when keyed against the update flow — strip the prefix when
        // present so the lookup hits the producer table cleanly.
        const stripped = recordId.indexOf('pa:') === 0 ? recordId.slice(3) : recordId;
        let key = '';
        if (kind === 'section') {
          key = keyByConsolidatedSection[stripped] || '';
        } else {
          key = keyByConsolidatedArticle[stripped] || '';
        }
        if (key && r.get('recordKey') !== key) {
          r.set('recordKey', key);
          app.save(r);
        }
      }
    }
  },
  (app) => {
    // Down: drop the added fields + indexes. Old foreign-key columns
    // are untouched, so the previous code path resumes working.
    function dropField(collectionName, fieldName) {
      try {
        const col = app.findCollectionByNameOrId(collectionName);
        const f = col.fields.find((x) => x.name === fieldName);
        if (f) col.fields.removeById(f.id);
        col.indexes = col.indexes.filter((idx) => idx.indexOf(fieldName) === -1);
        app.save(col);
      } catch (_) {
        /* collection missing — nothing to do */
      }
    }

    dropField('consolidatedArticles', 'articleKey');
    dropField('newArticleSuggestions', 'articleKey');
    dropField('articleUpdateSuggestions', 'articleKey');
    dropField('consolidatedSections', 'sectionKey');
    dropField('articleBacklog', 'articleKey');
    dropField('articleReviews', 'articleKey');
    dropField('sectionReviews', 'sectionKey');
    dropField('reviewComments', 'recordKey');
  },
);
