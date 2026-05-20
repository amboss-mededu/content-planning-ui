import { describe, expect, it } from 'vitest';
import {
  applyArticleDecision,
  applySectionDecision,
  approvedNewArticleKeys,
  approvedUpdateArticleKeys,
  currentArticleCandidates,
  currentSectionCandidates,
  type ProjectionState,
  reviewCompletion,
} from './approval-projection';

const emptyState: ProjectionState = {
  articleReviews: {},
  sectionReviews: {},
  articleBacklog: {},
};

describe('approval projection mutations', () => {
  it('approving a new article creates an approved review and type=new backlog row', () => {
    const next = applyArticleDecision(
      emptyState,
      'new::cardiology::heart-failure',
      'approved',
    );

    expect(next.articleReviews['new::cardiology::heart-failure']).toEqual({
      status: 'approved',
    });
    expect(next.articleBacklog['new::cardiology::heart-failure']).toEqual({
      type: 'new',
    });
  });

  it('approving a section creates an approved review and parent type=update backlog row', () => {
    const next = applySectionDecision(
      emptyState,
      'sec-upd::cardiac::a-1::s-1',
      'a-1',
      ['sec-upd::cardiac::a-1::s-1'],
      'approved',
    );

    expect(next.sectionReviews['sec-upd::cardiac::a-1::s-1']).toEqual({
      status: 'approved',
    });
    expect(next.articleBacklog['upd::a-1']).toEqual({ type: 'update' });
  });

  it('rejecting or clearing a new article removes backlog membership', () => {
    const approved = applyArticleDecision(
      emptyState,
      'new::cardiology::heart-failure',
      'approved',
    );
    const rejected = applyArticleDecision(
      approved,
      'new::cardiology::heart-failure',
      'rejected',
    );
    const cleared = applyArticleDecision(
      approved,
      'new::cardiology::heart-failure',
      null,
    );

    expect(rejected.articleReviews['new::cardiology::heart-failure']).toEqual({
      status: 'rejected',
    });
    expect(rejected.articleBacklog['new::cardiology::heart-failure']).toBeUndefined();
    expect(cleared.articleReviews['new::cardiology::heart-failure']).toBeUndefined();
    expect(cleared.articleBacklog['new::cardiology::heart-failure']).toBeUndefined();
  });

  it('clearing one approved section keeps parent backlog if an approved sibling remains', () => {
    const withFirst = applySectionDecision(
      emptyState,
      'sec-upd::cardiac::a-1::s-1',
      'a-1',
      ['sec-upd::cardiac::a-1::s-1', 'sec-upd::cardiac::a-1::s-2'],
      'approved',
    );
    const withBoth = applySectionDecision(
      withFirst,
      'sec-upd::cardiac::a-1::s-2',
      'a-1',
      ['sec-upd::cardiac::a-1::s-1', 'sec-upd::cardiac::a-1::s-2'],
      'approved',
    );
    const next = applySectionDecision(
      withBoth,
      'sec-upd::cardiac::a-1::s-1',
      'a-1',
      ['sec-upd::cardiac::a-1::s-1', 'sec-upd::cardiac::a-1::s-2'],
      null,
    );

    expect(next.sectionReviews['sec-upd::cardiac::a-1::s-1']).toBeUndefined();
    expect(next.articleBacklog['upd::a-1']).toEqual({ type: 'update' });
  });

  it('clearing the last approved section removes the parent update backlog row', () => {
    const approved = applySectionDecision(
      emptyState,
      'sec-upd::cardiac::a-1::s-1',
      'a-1',
      ['sec-upd::cardiac::a-1::s-1'],
      'approved',
    );
    const next = applySectionDecision(
      approved,
      'sec-upd::cardiac::a-1::s-1',
      'a-1',
      ['sec-upd::cardiac::a-1::s-1'],
      null,
    );

    expect(next.sectionReviews['sec-upd::cardiac::a-1::s-1']).toBeUndefined();
    expect(next.articleBacklog['upd::a-1']).toBeUndefined();
  });
});

describe('approval read models', () => {
  const articles = [
    {
      articleKey: 'new::cardiology::heart-failure',
      articleTitle: 'Heart failure',
      category: 'Cardiology',
    },
    {
      articleKey: 'new::cardiology::hypertension',
      articleTitle: 'Hypertension',
      category: 'Cardiology',
    },
  ];
  const sections = [
    {
      sectionKey: 'sec-upd::cardiac::a-1::s-1',
      articleId: 'a-1',
      sectionId: 's-1',
      category: 'Cardiac',
    },
    {
      sectionKey: 'sec-upd::vascular::a-1::s-1',
      articleId: 'a-1',
      sectionId: 's-1',
      category: 'Vascular',
    },
  ];

  it('New Articles and Article Updates expose all current candidates', () => {
    expect(currentArticleCandidates(articles)).toEqual(articles);
    expect(currentSectionCandidates(sections)).toEqual(sections);
  });

  it('Backlog exposes only approved backlog-backed new and update rows', () => {
    expect(
      approvedNewArticleKeys({
        slug: 'cardiology',
        articles,
        reviews: {
          'new::cardiology::heart-failure': { status: 'approved' },
          'new::cardiology::hypertension': { status: 'approved' },
        },
        backlog: {
          'new::cardiology::heart-failure': { type: 'new' },
        },
      }),
    ).toEqual(['new::cardiology::heart-failure']);

    expect(
      approvedUpdateArticleKeys({
        slug: 'cardiology',
        sections,
        reviews: {
          'sec-upd::cardiac::a-1::s-1': { status: 'approved' },
          'sec-upd::vascular::a-1::s-1': { status: 'rejected' },
        },
        backlog: {
          'upd::a-1': { type: 'update' },
        },
      }),
    ).toEqual(['upd::a-1']);
  });

  it('completion works for category-scoped sec-upd keys', () => {
    expect(
      reviewCompletion({
        slug: 'cardiology',
        articles: [],
        sections,
        articleReviews: {},
        sectionReviews: {
          'sec-upd::cardiac::a-1::s-1': { status: 'approved' },
          'sec-upd::vascular::a-1::s-1': { status: 'rejected' },
        },
        backlog: {
          'upd::a-1': { type: 'update' },
        },
      }).sectionsDone,
    ).toBe(true);
  });
});
