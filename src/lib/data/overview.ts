import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type {
  ArticleReviewRecord,
  ArticleSuggestionRecord,
  CodeRecord,
  ConsolidatedSectionRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';

export interface OverviewCounts {
  codes: number;
  mappedCodes: number;
  /** Distinct values of `category` in the codes table — source ontology. */
  sourceCategories: number;
  /** Distinct values of `consolidationCategory` in the codes table — the
   *  bucketing the consolidation step produced. */
  consolidationCategories: number;
  /** 2nd-pass deduped new-article output (what editors approve). */
  newArticles: number;
  /** Of those, how many have an `approved` articleReviews row keyed by
   *  the suggestion's articleKey. */
  newArticlesApproved: number;
  /** 2nd-pass deduped article-update output. */
  articleUpdates: number;
  /** Approved `sectionReviews` rows for the specialty. */
  sectionsApproved: number;
  /** Distinct parent CMS articleIds among approved sections. */
  articlesWithApprovedSections: number;
}

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Specialty overview counts. Fetches the full row sets we need to derive
 * per-bucket counts and approved-state joins — PB has no per-field
 * cardinality endpoint, so a single scan per collection is the cleanest
 * path. At our scale (low thousands of rows per collection) this stays
 * well under a second.
 */
export async function getOverviewCounts(slug: string): Promise<OverviewCounts> {
  await connection();
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}"`;

  const [codes, newSuggestions, articleReviews, sections, sectionReviews, updates] =
    await Promise.all([
      pb.collection<CodeRecord>('codes').getFullList({ filter }),
      pb
        .collection<ArticleSuggestionRecord>('newArticleSuggestions')
        .getFullList({ filter }),
      pb.collection<ArticleReviewRecord>('articleReviews').getFullList({ filter }),
      pb
        .collection<ConsolidatedSectionRecord>('consolidatedSections')
        .getFullList({ filter }),
      pb.collection<SectionReviewRecord>('sectionReviews').getFullList({ filter }),
      pb
        .collection('articleUpdateSuggestions')
        .getList(1, 1, { filter, skipTotal: false }),
    ]);

  let mappedCodes = 0;
  const sourceCats = new Set<string>();
  const consolidationCats = new Set<string>();
  for (const c of codes) {
    if ((c.mappedAt ?? 0) > 0) mappedCodes++;
    if (c.category) sourceCats.add(c.category);
    if (c.consolidationCategory) consolidationCats.add(c.consolidationCategory);
  }

  // newArticlesApproved: count of newArticleSuggestions whose articleKey
  // has an approved review row. Reviews keyed by articleKey now (stable
  // across consolidation re-runs) so the join is direct.
  const approvedArticleKeys = new Set<string>();
  for (const r of articleReviews) {
    if (r.status === 'approved' && r.articleKey) approvedArticleKeys.add(r.articleKey);
  }
  let newArticlesApproved = 0;
  for (const s of newSuggestions) {
    if (s.articleKey && approvedArticleKeys.has(s.articleKey)) newArticlesApproved++;
  }

  // Approved section reviews keyed by sectionKey; resolve each to its
  // parent CMS articleId via consolidatedSections so we can count
  // distinct parent articles.
  const approvedSectionKeys = new Set<string>();
  for (const r of sectionReviews) {
    if (r.status === 'approved' && r.sectionKey) approvedSectionKeys.add(r.sectionKey);
  }
  const articlesWithApprovedSections = new Set<string>();
  let sectionsApproved = 0;
  for (const s of sections) {
    if (!s.sectionKey || !approvedSectionKeys.has(s.sectionKey)) continue;
    sectionsApproved++;
    if (s.articleId) articlesWithApprovedSections.add(s.articleId);
  }

  return {
    codes: codes.length,
    mappedCodes,
    sourceCategories: sourceCats.size,
    consolidationCategories: consolidationCats.size,
    newArticles: newSuggestions.length,
    newArticlesApproved,
    articleUpdates: updates.totalItems,
    sectionsApproved,
    articlesWithApprovedSections: articlesWithApprovedSections.size,
  };
}
