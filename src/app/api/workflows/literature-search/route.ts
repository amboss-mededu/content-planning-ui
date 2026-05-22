/**
 * Trigger endpoint for the literature-search workflow.
 *
 * POST /api/workflows/literature-search
 *   body: {
 *     specialtySlug: string,
 *     articleRecordIds?: string[],   // narrow the run to specific rows
 *   }
 *
 * Responsibility:
 *   1. Verify auth + specialty.
 *   2. Resolve the Google API key (Gemini-only workflow).
 *   3. Find approved new-article candidates whose effective
 *      backlog status is `waiting-for-sources` (no PB row, status=
 *      `unassigned`, or status=`waiting-for-sources` are all treated
 *      as waiting). When `articleRecordIds` is provided, the eligible
 *      set is intersected with it so editors can search a chosen subset.
 *   4. Skip with 200 + `{ skipped: true }` if nothing to do — no run
 *      row created.
 *   5. Otherwise create the pipelineRuns + pipelineStages rows and
 *      kick off the background worker fire-and-forget.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { extractCodes } from '@/app/planning/_components/code-utils';
import { requireUserResponse } from '@/lib/auth';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import {
  attachPipelineRunToLitSearchRunsAsAdmin,
  claimArticleLitSearchRunAsAdmin,
  finishArticleLitSearchRunAsAdmin,
} from '@/lib/data/article-lit-search-runs';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { createPipelineRun, initPipelineStage } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { runLiteratureSearch } from '@/lib/workflows/literature-search';

type Body = { specialtySlug?: string; articleRecordIds?: string[] };

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug;
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }
  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const apiKeys = await resolveApiKeysForRun(['google']);
  if (!apiKeys.google) {
    return NextResponse.json(
      {
        error: 'No Google API key configured.',
        code: 'MISSING_API_KEY',
        provider: 'google',
      },
      { status: 409 },
    );
  }

  const [suggestions, reviews, backlog] = await Promise.all([
    listConsolidatedArticles(slug),
    listArticleReviews(slug),
    listArticleBacklog(slug),
  ]);

  // Eligible articles: approved new-article candidates whose effective status is
  // waiting-for-sources (no row, unassigned, or explicit waiting).
  // Reviews and backlog are keyed by stable `articleKey` (survives
  // consolidation re-runs); `filterIds` keeps using PB id because the
  // frontend sends `articleRecordId` from the consolidated row.
  const filterIds = Array.isArray(body.articleRecordIds)
    ? new Set(body.articleRecordIds.filter((s) => typeof s === 'string' && s.length > 0))
    : null;
  const eligible = suggestions.filter((r) => {
    if (!r.id || !r.articleKey) return false;
    if (reviews[r.articleKey]?.status !== 'approved') return false;
    if (filterIds && !filterIds.has(r.id)) return false;
    const status = backlog[r.articleKey]?.status;
    return (
      status === undefined || status === 'unassigned' || status === 'waiting-for-sources'
    );
  });

  if (eligible.length === 0) {
    return NextResponse.json({ skipped: true, articles: 0 });
  }

  const claimed: Array<{
    id: string;
    articleTitle?: string;
    articleKey: string;
    codes: string[];
    litSearchRunId: string;
  }> = [];
  let alreadyRunning = 0;
  for (const r of eligible) {
    const id = r.id ?? '';
    const codeRows = extractCodes(r.codes);
    const claim = await claimArticleLitSearchRunAsAdmin({
      specialtySlug: slug,
      articleKey: r.articleKey ?? '',
      articleRecordId: id,
    });
    if (!claim.claimed) {
      alreadyRunning++;
      continue;
    }
    claimed.push({
      id,
      articleTitle: r.articleTitle,
      articleKey: r.articleKey ?? '',
      codes: codeRows.map((c) => c.description ?? c.code).filter((s): s is string => !!s),
      litSearchRunId: claim.record.id,
    });
  }

  if (claimed.length === 0) {
    return NextResponse.json({
      skipped: true,
      reason: alreadyRunning > 0 ? 'already_running' : 'no_claims',
      articles: 0,
      alreadyRunning,
    });
  }

  let runId: string;
  try {
    const run = await createPipelineRun({ specialtySlug: slug });
    runId = run.id;
    await initPipelineStage({ runId, stage: 'literature_search' });
    await attachPipelineRunToLitSearchRunsAsAdmin(
      claimed.map((article) => article.litSearchRunId),
      runId,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await Promise.all(
      claimed.map((article) =>
        finishArticleLitSearchRunAsAdmin(article.litSearchRunId, {
          status: 'failed',
          errorMessage: `Failed to start literature-search run: ${msg}`,
          sourcesCount: 0,
        }),
      ),
    );
    throw e;
  }

  void runLiteratureSearch({
    runId,
    specialtySlug: slug,
    articles: claimed,
    apiKeys,
  }).catch((e) => {
    console.error('[literature-search] unhandled rejection', e);
  });

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag(`specialty:${slug}`, 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    articles: claimed.length,
    alreadyRunning,
  });
}
