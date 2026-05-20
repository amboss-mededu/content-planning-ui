/// <reference path="../pb_data/types.d.ts" />

// Keep persisted approvals aligned with the single approval path:
// approved articleReviews get type='new' backlog rows, approved
// sectionReviews get parent type='update' backlog rows. Also rekeys
// existing CMS section-update rows so sec-upd keys include category,
// matching src/lib/data/article-keys.ts.

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

    function computeSectionKey(slug, articleTitle, articleId, sectionName, sectionId, category) {
      const aid = (articleId || '').trim();
      const sid = (sectionId || '').trim();
      const cat = (category || '').trim();
      if (aid && sid) {
        if (cat) return 'sec-upd::' + normalize(cat) + '::' + aid + '::' + sid;
        return 'sec-upd::' + aid + '::' + sid;
      }
      const at = (articleTitle || '').trim();
      const sn = (sectionName || '').trim();
      const sl = (slug || '').trim();
      if (!at || !sn || !sl) return '';
      if (cat) {
        return 'sec::' + sl + '::' + normalize(cat) + '::' + normalize(at) + '::' + normalize(sn);
      }
      return 'sec::' + sl + '::' + normalize(at) + '::' + normalize(sn);
    }

    function backlogKey(slug, articleKey) {
      return slug + '\n' + articleKey;
    }

    const sections = app.findAllRecords('consolidatedSections');
    const oldToNewSectionKey = {};
    const sectionById = {};
    const sectionByNewKey = {};
    for (const section of sections) {
      const oldKey = section.get('sectionKey') || '';
      const nextKey = computeSectionKey(
        section.get('specialtySlug'),
        section.get('articleTitle'),
        section.get('articleId'),
        section.get('sectionName'),
        section.get('sectionId'),
        section.get('category'),
      );
      if (nextKey) {
        if (oldKey && oldKey !== nextKey) oldToNewSectionKey[oldKey] = nextKey;
        if (section.get('sectionKey') !== nextKey) {
          section.set('sectionKey', nextKey);
          app.save(section);
        }
      }
      sectionById[section.id] = section;
      if (nextKey) sectionByNewKey[nextKey] = section;
    }

    for (const review of app.findAllRecords('sectionReviews')) {
      const oldKey = review.get('sectionKey') || '';
      const nextKey = oldToNewSectionKey[oldKey] || oldKey;
      if (nextKey && oldKey !== nextKey) {
        review.set('sectionKey', nextKey);
        app.save(review);
      }
    }

    for (const comment of app.findAllRecords('reviewComments')) {
      if (comment.get('recordKind') !== 'section') continue;
      const oldKey = comment.get('recordKey') || '';
      const nextKey = oldToNewSectionKey[oldKey] || oldKey;
      if (nextKey && oldKey !== nextKey) {
        comment.set('recordKey', nextKey);
        app.save(comment);
      }
    }

    const backlogCollection = app.findCollectionByNameOrId('articleBacklog');
    const existingBacklog = {};
    for (const row of app.findAllRecords('articleBacklog')) {
      const articleKey = row.get('articleKey') || '';
      if (articleKey) existingBacklog[backlogKey(row.get('specialtySlug'), articleKey)] = row;
    }

    function ensureBacklog(slug, articleKey, articleRecordId, type) {
      if (!slug || !articleKey) return;
      const key = backlogKey(slug, articleKey);
      const existing = existingBacklog[key];
      if (existing) {
        if (!existing.get('type')) {
          existing.set('type', type);
          app.save(existing);
        }
        return;
      }
      const row = new Record(backlogCollection, {
        specialtySlug: slug,
        articleKey,
        articleRecordId: articleRecordId || '',
        type,
        status: 'waiting-for-sources',
        lastChangedByEmail: '',
        lastChangedAt: Date.now(),
      });
      app.save(row);
      existingBacklog[key] = row;
    }

    for (const review of app.findAllRecords('articleReviews')) {
      if (review.get('status') !== 'approved') continue;
      ensureBacklog(
        review.get('specialtySlug'),
        review.get('articleKey'),
        review.get('articleRecordId'),
        'new',
      );
    }

    for (const review of app.findAllRecords('sectionReviews')) {
      if (review.get('status') !== 'approved') continue;
      const section =
        sectionById[review.get('sectionRecordId')] || sectionByNewKey[review.get('sectionKey')];
      if (!section) continue;
      const parentArticleId = section.get('articleId') || '';
      if (!parentArticleId) continue;
      ensureBacklog(
        review.get('specialtySlug'),
        'upd::' + parentArticleId,
        parentArticleId,
        'update',
      );
    }
  },
  () => {
    // No-op down migration: deleting derived backlog rows would remove
    // editor workflow state, and reverting section keys would reintroduce
    // category collisions.
  },
);
