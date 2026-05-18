/// <reference path="../pb_data/types.d.ts" />

// Attach `articleKey` to `articleSources` so source lists survive a
// consolidation re-run.
//
// Why: literature-search inserts sources keyed by the
// `newArticleSuggestions` PB id (`articleRecordId`). When consolidation
// re-runs that producer row is replaced and the old id is orphaned,
// leaving the sources unattached. The stable, content-derived
// `articleKey` survives the re-run, so consumers (backlog,
// my-backlog) can keep showing the source count + drawer rows.
//
// Backfill resolves the existing `articleRecordId` to the matching
// producer in newArticleSuggestions first, then articleUpdateSuggestions,
// then consolidatedArticles. Rows whose foreign id no longer resolves
// keep an empty key; consumer queries will simply not surface them
// (they'd already be invisible in the UI today).

migrate(
  (app) => {
    function addTextField(collectionName, fieldName, fieldId) {
      const col = app.findCollectionByNameOrId(collectionName);
      if (col.fields.find((f) => f.name === fieldName)) return;
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
    }

    function addIndex(collectionName, indexSql) {
      const col = app.findCollectionByNameOrId(collectionName);
      if (col.indexes.find((idx) => idx === indexSql)) return;
      col.indexes.push(indexSql);
      app.save(col);
    }

    function buildKeyMap(collectionName, keyField) {
      const out = {};
      const rows = app.findAllRecords(collectionName);
      for (const r of rows) {
        const k = r.get(keyField);
        if (k) out[r.id] = k;
      }
      return out;
    }

    addTextField('articleSources', 'articleKey', 'text_articleKey_articleSources');
    addIndex(
      'articleSources',
      'CREATE INDEX `idx_articleSources_articleKey` ON `articleSources` (`articleKey`)',
    );

    const keyByNewSuggestion = buildKeyMap('newArticleSuggestions', 'articleKey');
    const keyByUpdateSuggestion = buildKeyMap('articleUpdateSuggestions', 'articleKey');
    const keyByConsolidatedArticle = buildKeyMap('consolidatedArticles', 'articleKey');

    const rows = app.findAllRecords('articleSources');
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
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('articleSources');
      const f = col.fields.find((x) => x.name === 'articleKey');
      if (f) col.fields.removeById(f.id);
      col.indexes = col.indexes.filter((idx) => idx.indexOf('articleKey') === -1);
      app.save(col);
    } catch (_) {
      /* collection missing — nothing to do */
    }
  },
);
