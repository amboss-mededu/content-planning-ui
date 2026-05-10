/// <reference path="../pb_data/types.d.ts" />

// Extend reviewComments.recordKind so it can also key comments to the
// section's parent AMBOSS article (used by the per-article view inside
// the section review modal). Distinct from 'article' which keys to a
// `consolidatedArticles` PB record id (used by the New Articles review
// modal). 'parent-article' uses the AMBOSS article id from
// `consolidatedSections.articleId` (with the title as a fallback).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('reviewComments');
    const f = col.fields.getByName('recordKind');
    if (!f) return;
    const current = Array.isArray(f.values) ? f.values : [];
    if (current.includes('parent-article')) return;
    f.values = [...current, 'parent-article'];
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('reviewComments');
    const f = col.fields.getByName('recordKind');
    if (!f) return;
    const current = Array.isArray(f.values) ? f.values : [];
    f.values = current.filter((v) => v !== 'parent-article');
    app.save(col);
  },
);
