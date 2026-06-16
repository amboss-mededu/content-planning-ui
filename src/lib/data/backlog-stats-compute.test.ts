import { describe, expect, it } from 'vitest';
import type { ArticleBacklogRecord, ArticleBacklogStatus } from '@/lib/pb/types';
import { computeBacklogStats } from './backlog-stats-compute';

function makeRow(partial: Partial<ArticleBacklogRecord>): ArticleBacklogRecord {
  return {
    id: Math.random().toString(36).slice(2),
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'articleBacklog',
    specialtySlug: 'spec',
    articleRecordId: '',
    articleKey: Math.random().toString(36).slice(2),
    status: 'waiting-for-sources',
    ...partial,
  } as ArticleBacklogRecord;
}

describe('computeBacklogStats', () => {
  it('treats a missing type as a new article', () => {
    const stats = computeBacklogStats([
      makeRow({ status: 'waiting-for-sources' }),
      makeRow({ type: 'new', status: 'published' }),
    ]);
    expect(stats.newArticles).toBe(2);
    expect(stats.articleUpdates).toBe(0);
  });

  it('counts update-typed rows as article updates', () => {
    const stats = computeBacklogStats([
      makeRow({ type: 'update', status: 'sources-approved' }),
      makeRow({ type: 'update', status: 'published' }),
      makeRow({ type: 'new', status: 'published' }),
    ]);
    expect(stats.articleUpdates).toBe(2);
    expect(stats.newArticles).toBe(1);
    expect(stats.total).toBe(3);
  });

  it('collapses the 9 statuses into the 3 badge buckets', () => {
    // choose-sources covers everything before a draft exists.
    const chooseSourcesStatuses: ArticleBacklogStatus[] = [
      'unassigned',
      'waiting-for-sources',
      'sources-searched',
      'sources-approved',
      'ready-for-llm-draft',
    ];
    // drafted covers a draft existing through ready-to-publish.
    const draftedStatuses: ArticleBacklogStatus[] = [
      'ready-for-editing',
      'editing-in-progress',
      'ready-to-publish',
    ];
    const stats = computeBacklogStats([
      ...chooseSourcesStatuses.map((status) => makeRow({ status })),
      ...draftedStatuses.map((status) => makeRow({ status })),
      makeRow({ status: 'published' }),
    ]);

    expect(stats.chooseSources.total).toBe(5);
    expect(stats.drafted.total).toBe(3);
    expect(stats.published.total).toBe(1);
    expect(stats.total).toBe(9);
  });

  it('splits each stage by new vs update', () => {
    const stats = computeBacklogStats([
      makeRow({ type: 'new', status: 'waiting-for-sources' }),
      makeRow({ type: 'new', status: 'sources-approved' }),
      makeRow({ type: 'update', status: 'ready-for-llm-draft' }),
      makeRow({ type: 'new', status: 'editing-in-progress' }),
      makeRow({ type: 'update', status: 'ready-to-publish' }),
      makeRow({ type: 'new', status: 'published' }),
      makeRow({ type: 'update', status: 'published' }),
    ]);

    expect(stats.chooseSources).toEqual({ new: 2, update: 1, total: 3 });
    expect(stats.drafted).toEqual({ new: 1, update: 1, total: 2 });
    expect(stats.published).toEqual({ new: 1, update: 1, total: 2 });
    // Per-stage totals reconcile with the top-line totals.
    expect(stats.newArticles).toBe(4);
    expect(stats.articleUpdates).toBe(3);
  });

  it('returns all zeros for an empty backlog', () => {
    const stats = computeBacklogStats([]);
    expect(stats).toEqual({
      total: 0,
      newArticles: 0,
      articleUpdates: 0,
      chooseSources: { new: 0, update: 0, total: 0 },
      drafted: { new: 0, update: 0, total: 0 },
      published: { new: 0, update: 0, total: 0 },
    });
  });
});
