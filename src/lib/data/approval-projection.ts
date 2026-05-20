import { computeArticleKey, computeSectionKey } from './article-keys';

type ReviewStatus = 'approved' | 'rejected';
type BacklogType = 'new' | 'update';

export type ReviewProjection = { status: ReviewStatus };
export type BacklogProjection = { type?: BacklogType; status?: string };

export type ArticleCandidateProjection = {
  articleKey?: string;
  articleTitle?: string | null;
  articleId?: string | null;
  category?: string | null;
};

export type SectionCandidateProjection = {
  sectionKey?: string;
  articleTitle?: string | null;
  articleId?: string | null;
  sectionName?: string | null;
  sectionId?: string | null;
  category?: string | null;
};

export function articleCandidateKey(
  slug: string,
  article: ArticleCandidateProjection,
): string {
  return (
    article.articleKey ||
    computeArticleKey({
      specialtySlug: slug,
      articleTitle: article.articleTitle,
      articleId: article.articleId,
      category: article.category,
    })
  );
}

export function sectionCandidateKey(
  slug: string,
  section: SectionCandidateProjection,
): string {
  return (
    section.sectionKey ||
    computeSectionKey({
      specialtySlug: slug,
      articleTitle: section.articleTitle,
      articleId: section.articleId,
      sectionName: section.sectionName,
      sectionId: section.sectionId,
      category: section.category,
    })
  );
}

export function currentArticleCandidates<T extends ArticleCandidateProjection>(
  articles: T[],
): T[] {
  return articles;
}

export function currentSectionCandidates<T extends SectionCandidateProjection>(
  sections: T[],
): T[] {
  return sections;
}

export function approvedNewArticleKeys(input: {
  slug: string;
  articles: ArticleCandidateProjection[];
  reviews: Record<string, ReviewProjection | undefined>;
  backlog: Record<string, BacklogProjection | undefined>;
}): string[] {
  const keys: string[] = [];
  for (const article of input.articles) {
    const key = articleCandidateKey(input.slug, article);
    if (!key) continue;
    if (input.reviews[key]?.status === 'approved' && input.backlog[key]?.type === 'new') {
      keys.push(key);
    }
  }
  return keys;
}

export function approvedUpdateArticleKeys(input: {
  slug: string;
  sections: SectionCandidateProjection[];
  reviews: Record<string, ReviewProjection | undefined>;
  backlog: Record<string, BacklogProjection | undefined>;
}): string[] {
  const keys = new Set<string>();
  for (const section of input.sections) {
    const sectionKey = sectionCandidateKey(input.slug, section);
    if (!sectionKey || input.reviews[sectionKey]?.status !== 'approved') continue;
    if (!section.articleId) continue;
    const articleKey = `upd::${section.articleId}`;
    if (input.backlog[articleKey]?.type === 'update') keys.add(articleKey);
  }
  return Array.from(keys);
}

export type ProjectionState = {
  articleReviews: Record<string, ReviewProjection | undefined>;
  sectionReviews: Record<string, ReviewProjection | undefined>;
  articleBacklog: Record<string, BacklogProjection | undefined>;
};

export function applyArticleDecision(
  state: ProjectionState,
  articleKey: string,
  status: ReviewStatus | null,
): ProjectionState {
  const next: ProjectionState = {
    articleReviews: { ...state.articleReviews },
    sectionReviews: { ...state.sectionReviews },
    articleBacklog: { ...state.articleBacklog },
  };
  if (status === null) {
    delete next.articleReviews[articleKey];
    delete next.articleBacklog[articleKey];
    return next;
  }
  next.articleReviews[articleKey] = { status };
  if (status === 'approved') {
    next.articleBacklog[articleKey] = { type: 'new' };
  } else {
    delete next.articleBacklog[articleKey];
  }
  return next;
}

export function applySectionDecision(
  state: ProjectionState,
  sectionKey: string,
  parentArticleId: string,
  siblingSectionKeys: string[],
  status: ReviewStatus | null,
): ProjectionState {
  const next: ProjectionState = {
    articleReviews: { ...state.articleReviews },
    sectionReviews: { ...state.sectionReviews },
    articleBacklog: { ...state.articleBacklog },
  };
  const articleKey = `upd::${parentArticleId}`;
  if (status === null) {
    delete next.sectionReviews[sectionKey];
  } else {
    next.sectionReviews[sectionKey] = { status };
  }

  if (status === 'approved') {
    next.articleBacklog[articleKey] = { type: 'update' };
    return next;
  }

  const approvedSiblingRemains = siblingSectionKeys.some(
    (key) => key !== sectionKey && next.sectionReviews[key]?.status === 'approved',
  );
  if (!approvedSiblingRemains) delete next.articleBacklog[articleKey];
  return next;
}

export function reviewCompletion(input: {
  slug: string;
  articles: ArticleCandidateProjection[];
  sections: SectionCandidateProjection[];
  articleReviews: Record<string, ReviewProjection | undefined>;
  sectionReviews: Record<string, ReviewProjection | undefined>;
  backlog: Record<string, BacklogProjection | undefined>;
}): {
  articlesDone: boolean;
  sectionsDone: boolean;
} {
  let decidedArticles = 0;
  let articleApprovalsHaveBacklog = true;
  for (const article of input.articles) {
    const key = articleCandidateKey(input.slug, article);
    if (!key) continue;
    const review = input.articleReviews[key];
    if (!review) continue;
    decidedArticles += 1;
    if (review.status === 'approved' && input.backlog[key]?.type !== 'new') {
      articleApprovalsHaveBacklog = false;
    }
  }

  let decidedSections = 0;
  let sectionApprovalsHaveBacklog = true;
  for (const section of input.sections) {
    const key = sectionCandidateKey(input.slug, section);
    if (!key) continue;
    const review = input.sectionReviews[key];
    if (!review) continue;
    decidedSections += 1;
    if (
      review.status === 'approved' &&
      (!section.articleId ||
        input.backlog[`upd::${section.articleId}`]?.type !== 'update')
    ) {
      sectionApprovalsHaveBacklog = false;
    }
  }

  return {
    articlesDone:
      input.articles.length > 0 &&
      decidedArticles === input.articles.length &&
      articleApprovalsHaveBacklog,
    sectionsDone:
      input.sections.length > 0 &&
      decidedSections === input.sections.length &&
      sectionApprovalsHaveBacklog,
  };
}
