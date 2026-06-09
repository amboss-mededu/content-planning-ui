/**
 * Trigger endpoint for Stage 2 of the article-generation pipeline:
 * register every source's metadata in Cortex CMS.
 *
 * POST /api/workflows/cortex-register
 *   body: one of
 *     { specialtySlug, articleRecordId }            // single
 *     { specialtySlug, articleRecordIds: string[] } // bulk
 *
 * Each article is processed with bounded concurrency (pLimit=3) so a
 * bulk run can't fan out unbounded Cortex POSTs. Synchronous: the
 * request thread waits for completion (typical: ~5 sources × ~200ms ≈
 * 1s per article).
 *
 * On per-article success (every source ends with a non-empty
 * cortexSourceId) the backlog row is auto-advanced
 * `sources-approved` → `ready-for-llm-draft`. The runtime does NOT
 * check that the row is in `sources-approved` first — manual flips
 * outside that range are fine; the worst case is an unnecessary
 * status change.
 *
 * Returns per-article outcomes so the UI can show a partial-success
 * summary (e.g. "2 sources registered, 1 failed").
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, requireUserResponse } from '@/lib/auth';
import { getSpecialty } from '@/lib/data/specialties';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { runCortexRegistration } from '@/lib/workflows/cortex-register/run';

const Body = z.object({
  specialtySlug: z.string().optional(),
  articleRecordId: z.string().optional(),
  articleRecordIds: z.array(z.string()).optional().catch(undefined),
});

const MAX_CONCURRENT = 3;

async function processBatch<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  const slug = body.specialtySlug?.trim();
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const ids =
    body.articleRecordIds?.filter((s) => typeof s === 'string' && s.length > 0) ??
    (body.articleRecordId ? [body.articleRecordId] : []);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: 'articleRecordId or articleRecordIds required' },
      { status: 400 },
    );
  }

  const viewer = await getCurrentUser();
  const requestedByEmail = viewer?.email ?? null;

  const results = await processBatch(ids, MAX_CONCURRENT, async (articleRecordId) => {
    try {
      const out = await runCortexRegistration({
        specialtySlug: slug,
        articleRecordId,
        requestedByEmail,
      });
      return { articleRecordId, ok: true, ...out };
    } catch (e) {
      return {
        articleRecordId,
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  const totals = results.reduce(
    (acc, r) => {
      if (!r.ok) {
        acc.articlesFailed++;
        return acc;
      }
      acc.registered += r.counts.registered;
      acc.reused += r.counts.reused;
      acc.failed += r.counts.failed;
      if (r.fullyRegistered) acc.articlesAdvanced++;
      return acc;
    },
    {
      registered: 0,
      reused: 0,
      failed: 0,
      articlesAdvanced: 0,
      articlesFailed: 0,
    },
  );

  return NextResponse.json({
    specialty: slug,
    articles: results.length,
    totals,
    results,
  });
}
