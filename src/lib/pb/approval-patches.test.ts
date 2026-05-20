import { describe, expect, it } from 'vitest';
import type {
  ArticleBacklogRecord,
  ArticleReviewRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';
import {
  applyBacklogPatches,
  applyReviewPatches,
  type BacklogPatch,
  dropExpiredPatches,
  type ReviewPatch,
  reconcileBacklogPatches,
  reconcileReviewPatches,
} from './approval-patches';

function articleReview(input: {
  id: string;
  articleKey: string;
  status: 'approved' | 'rejected';
}): ArticleReviewRecord {
  return {
    id: input.id,
    collectionId: 'articleReviews',
    collectionName: 'articleReviews',
    created: '',
    updated: '',
    specialtySlug: 'cardiology',
    articleKey: input.articleKey,
    articleRecordId: 'pb-1',
    status: input.status,
    reviewerEmail: 'editor@amboss.com',
    reviewedAt: 0,
    notes: '',
  } as unknown as ArticleReviewRecord;
}

function sectionReview(input: {
  id: string;
  sectionKey: string;
  status: 'approved' | 'rejected';
}): SectionReviewRecord {
  return {
    id: input.id,
    collectionId: 'sectionReviews',
    collectionName: 'sectionReviews',
    created: '',
    updated: '',
    specialtySlug: 'cardiology',
    sectionKey: input.sectionKey,
    sectionRecordId: 'pb-1',
    status: input.status,
    reviewerEmail: 'editor@amboss.com',
    reviewedAt: 0,
    notes: '',
  } as unknown as SectionReviewRecord;
}

function backlog(input: {
  id: string;
  articleKey: string;
  type: 'new' | 'update';
}): ArticleBacklogRecord {
  return {
    id: input.id,
    collectionId: 'articleBacklog',
    collectionName: 'articleBacklog',
    created: '',
    updated: '',
    specialtySlug: 'cardiology',
    articleKey: input.articleKey,
    articleRecordId: 'pb-1',
    type: input.type,
    status: 'waiting-for-sources',
    assigneeEmail: '',
    lastChangedByEmail: '',
    lastChangedAt: 0,
    notes: '',
  } as unknown as ArticleBacklogRecord;
}

describe('applyReviewPatches', () => {
  it('synthesizes a pending row when a patch arrives ahead of realtime', () => {
    const next = applyReviewPatches<ArticleReviewRecord>(
      'articleReviews',
      [],
      [
        {
          collection: 'articleReviews',
          key: 'new::cardiology::heart-failure',
          override: 'approved',
          appliedAt: 100,
        },
      ],
      (r) => r.articleKey,
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.articleKey).toBe('new::cardiology::heart-failure');
    expect(next[0]?.status).toBe('approved');
    expect(next[0]?.id.startsWith('__pending::')).toBe(true);
  });

  it('drops a live row tombstoned by a patch', () => {
    const live = [
      articleReview({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        status: 'approved',
      }),
    ];
    const next = applyReviewPatches(
      'articleReviews',
      live,
      [
        {
          collection: 'articleReviews',
          key: 'new::cardiology::heart-failure',
          override: null,
          appliedAt: 100,
        },
      ],
      (r) => r.articleKey,
    );
    expect(next).toEqual([]);
  });

  it('ignores patches targeting a different collection', () => {
    const live = [
      articleReview({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        status: 'approved',
      }),
    ];
    const patches: ReviewPatch[] = [
      {
        collection: 'sectionReviews',
        key: 'sec-upd::cardiac::a-1::s-1',
        override: null,
        appliedAt: 100,
      },
    ];
    expect(
      applyReviewPatches('articleReviews', live, patches, (r) => r.articleKey),
    ).toEqual(live);
  });

  it('keeps the most-recent patch when two patches target the same key', () => {
    const next = applyReviewPatches<ArticleReviewRecord>(
      'articleReviews',
      [],
      [
        {
          collection: 'articleReviews',
          key: 'new::cardiology::heart-failure',
          override: 'approved',
          appliedAt: 100,
        },
        {
          collection: 'articleReviews',
          key: 'new::cardiology::heart-failure',
          override: null,
          appliedAt: 200,
        },
      ],
      (r) => r.articleKey,
    );
    expect(next).toEqual([]);
  });

  it('overrides a live row status with a status patch', () => {
    const live = [
      articleReview({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        status: 'approved',
      }),
    ];
    const next = applyReviewPatches(
      'articleReviews',
      live,
      [
        {
          collection: 'articleReviews',
          key: 'new::cardiology::heart-failure',
          override: 'rejected',
          appliedAt: 100,
        },
      ],
      (r) => r.articleKey,
    );
    expect(next[0]?.status).toBe('rejected');
  });
});

describe('applyBacklogPatches', () => {
  it('drops a backlog row tombstoned by a patch (Remove approval path)', () => {
    const live = [backlog({ id: 'pb-1', articleKey: 'upd::a-1', type: 'update' })];
    const next = applyBacklogPatches(live, [
      { key: 'upd::a-1', override: null, appliedAt: 100 },
    ]);
    expect(next).toEqual([]);
  });

  it('synthesizes a backlog row when an approve precedes realtime', () => {
    const next = applyBacklogPatches(
      [],
      [
        {
          key: 'new::cardiology::heart-failure',
          override: { type: 'new' },
          appliedAt: 100,
        },
      ],
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.type).toBe('new');
    expect(next[0]?.status).toBe('waiting-for-sources');
  });

  it('keeps live rows untouched when no patches apply', () => {
    const live = [backlog({ id: 'pb-1', articleKey: 'upd::a-1', type: 'update' })];
    expect(applyBacklogPatches(live, [])).toBe(live);
  });
});

describe('reconcileReviewPatches', () => {
  it('drops a status patch when the live row shows the same status', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: 'approved',
        appliedAt: 100,
      },
    ];
    const live = [
      articleReview({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        status: 'approved',
      }),
    ];
    expect(
      reconcileReviewPatches('articleReviews', patches, live, (r) => r.articleKey),
    ).toEqual([]);
  });

  it('keeps a status patch while the live row still shows the old status', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: 'approved',
        appliedAt: 100,
      },
    ];
    // Live row hasn't caught up yet — still rejected.
    const live = [
      articleReview({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        status: 'rejected',
      }),
    ];
    expect(
      reconcileReviewPatches('articleReviews', patches, live, (r) => r.articleKey),
    ).toEqual(patches);
  });

  it('keeps a status patch while the live row is missing entirely (subscription lag)', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: 'approved',
        appliedAt: 100,
      },
    ];
    expect(
      reconcileReviewPatches<ArticleReviewRecord>(
        'articleReviews',
        patches,
        [],
        (r) => r.articleKey,
      ),
    ).toEqual(patches);
  });

  it('drops a tombstone once the live row is actually gone', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: null,
        appliedAt: 100,
      },
    ];
    expect(
      reconcileReviewPatches<ArticleReviewRecord>(
        'articleReviews',
        patches,
        [],
        (r) => r.articleKey,
      ),
    ).toEqual([]);
  });

  it('keeps a tombstone while the live row still exists', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: null,
        appliedAt: 100,
      },
    ];
    const live = [
      articleReview({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        status: 'approved',
      }),
    ];
    expect(
      reconcileReviewPatches('articleReviews', patches, live, (r) => r.articleKey),
    ).toEqual(patches);
  });

  it('leaves patches in the other collection alone', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'sectionReviews',
        key: 'sec-upd::cardiac::a-1::s-1',
        override: 'approved',
        appliedAt: 100,
      },
    ];
    // Reconciling against articleReviews live data shouldn't drop a
    // sectionReviews patch.
    expect(
      reconcileReviewPatches<ArticleReviewRecord>(
        'articleReviews',
        patches,
        [],
        (r) => r.articleKey,
      ),
    ).toEqual(patches);
  });
});

describe('reconcileBacklogPatches', () => {
  it('drops a backlog tombstone once the live row is gone', () => {
    const patches: BacklogPatch[] = [{ key: 'upd::a-1', override: null, appliedAt: 100 }];
    expect(reconcileBacklogPatches(patches, [])).toEqual([]);
  });

  it('keeps a backlog tombstone while the live row still exists', () => {
    const patches: BacklogPatch[] = [{ key: 'upd::a-1', override: null, appliedAt: 100 }];
    const live = [backlog({ id: 'pb-1', articleKey: 'upd::a-1', type: 'update' })];
    expect(reconcileBacklogPatches(patches, live)).toEqual(patches);
  });

  it('drops a backlog ensure-new patch when the live row shows type=new', () => {
    const patches: BacklogPatch[] = [
      {
        key: 'new::cardiology::heart-failure',
        override: { type: 'new' },
        appliedAt: 100,
      },
    ];
    const live = [
      backlog({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        type: 'new',
      }),
    ];
    expect(reconcileBacklogPatches(patches, live)).toEqual([]);
  });
});

describe('dropExpiredPatches', () => {
  it('expires patches older than the TTL', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'k1',
        override: 'approved',
        appliedAt: 0,
      },
      {
        collection: 'articleReviews',
        key: 'k2',
        override: 'approved',
        appliedAt: 5500,
      },
    ];
    const next = dropExpiredPatches(patches, 7000);
    expect(next).toHaveLength(1);
    expect(next[0]?.key).toBe('k2');
  });

  it('returns the same reference when nothing expires (no needless re-render)', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'k1',
        override: 'approved',
        appliedAt: 5000,
      },
    ];
    expect(dropExpiredPatches(patches, 5500)).toBe(patches);
  });
});

describe('race scenarios', () => {
  it('approve-then-unapprove: the later tombstone wins', () => {
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: 'approved',
        appliedAt: 100,
      },
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: null,
        appliedAt: 200,
      },
    ];
    const next = applyReviewPatches(
      'articleReviews',
      [
        articleReview({
          id: 'pb-1',
          articleKey: 'new::cardiology::heart-failure',
          status: 'approved',
        }),
      ],
      patches,
      (r) => r.articleKey,
    );
    expect(next).toEqual([]);
  });

  it('a tombstone is not dropped while the (stale-status) live row still exists', () => {
    // User approved at t=100, an approve CREATE event arrives in live
    // data at t=200, then user unapproves at t=250 (tombstone patch).
    // The tombstone must hold until the DELETE event arrives — the
    // current approved live row must not satisfy the tombstone.
    const patches: ReviewPatch[] = [
      {
        collection: 'articleReviews',
        key: 'new::cardiology::heart-failure',
        override: null,
        appliedAt: 250,
      },
    ];
    const live = [
      articleReview({
        id: 'pb-1',
        articleKey: 'new::cardiology::heart-failure',
        status: 'approved',
      }),
    ];
    expect(
      reconcileReviewPatches('articleReviews', patches, live, (r) => r.articleKey),
    ).toEqual(patches);
  });
});

describe('section review fixtures keep section flow honest', () => {
  it('synthetic section row preserves the sectionKey', () => {
    const next = applyReviewPatches<SectionReviewRecord>(
      'sectionReviews',
      [],
      [
        {
          collection: 'sectionReviews',
          key: 'sec-upd::cardiac::a-1::s-1',
          override: 'approved',
          appliedAt: 100,
        },
      ],
      (r) => r.sectionKey,
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.sectionKey).toBe('sec-upd::cardiac::a-1::s-1');
    expect(next[0]?.status).toBe('approved');
  });

  it('tombstones a live section review row', () => {
    const live = [
      sectionReview({
        id: 'pb-1',
        sectionKey: 'sec-upd::cardiac::a-1::s-1',
        status: 'approved',
      }),
    ];
    const next = applyReviewPatches(
      'sectionReviews',
      live,
      [
        {
          collection: 'sectionReviews',
          key: 'sec-upd::cardiac::a-1::s-1',
          override: null,
          appliedAt: 100,
        },
      ],
      (r) => r.sectionKey,
    );
    expect(next).toEqual([]);
  });
});
