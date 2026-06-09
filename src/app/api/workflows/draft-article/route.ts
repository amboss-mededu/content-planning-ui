/**
 * Trigger endpoint for the draft-article (article creation) workflow.
 *
 * POST /api/workflows/draft-article   (multipart/form-data)
 *   fields: specialtySlug, articleRecordId, articleKey, articleTitle,
 *           language, articleLength, fileMetadata, handle,
 *           gDriveFolderUrl?, files[] (source PDFs named <ribosomId>.pdf)
 *
 * Single-article (the modal/backlog "Draft article" action) — no pipeline
 * run wrapper. Claims an `articleDraftRuns` row (the partial unique index
 * blocks a second concurrent draft), then dispatches the multipart job to
 * n8n. Results land via /api/workflows/draft-article/callback.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import { requireUserResponse } from '@/lib/auth';
import {
  claimArticleDraftRunAsAdmin,
  finishArticleDraftRunAsAdmin,
  reapStaleDraftRunsAsAdmin,
} from '@/lib/data/article-draft-runs';
import { getSpecialty } from '@/lib/data/specialties';
import { errorMessage } from '@/lib/error-message';
import { dispatchDraftArticle } from '@/lib/workflows/draft-article';

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };
  const slug = str('specialtySlug');
  const articleRecordId = str('articleRecordId');
  const articleKey = str('articleKey');
  const articleTitle = str('articleTitle');
  const language = str('language');
  const articleLength = str('articleLength');
  const fileMetadata = str('fileMetadata');
  const handle = str('handle');
  const gDriveFolderUrl = str('gDriveFolderUrl');
  const files = form
    .getAll('files')
    .filter((f): f is File => f instanceof File && f.size > 0);

  const missing = Object.entries({
    specialtySlug: slug,
    articleRecordId,
    articleKey,
    articleTitle,
    language,
    articleLength,
    fileMetadata,
    handle,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `missing required field(s): ${missing.join(', ')}` },
      { status: 400 },
    );
  }
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'at least one source PDF is required' },
      { status: 400 },
    );
  }

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  // Reap stuck `running` rows before claiming so a previously-stalled draft
  // doesn't keep blocking new attempts.
  await reapStaleDraftRunsAsAdmin(slug);

  const claim = await claimArticleDraftRunAsAdmin({
    specialtySlug: slug,
    articleKey,
    articleRecordId,
    handle,
    language,
    articleLength,
  });
  if (!claim.claimed) {
    return NextResponse.json(
      { skipped: true, reason: 'already_running', draftRunId: claim.record.id },
      { status: 409 },
    );
  }

  // Prefer the explicit override so local dev can hit a tunnel while the
  // browser keeps loading the app at localhost. Falls back to the request
  // origin, which is what production wants.
  const callbackOrigin = env.N8N_CALLBACK_BASE_URL ?? req.nextUrl.origin;
  const callbackUrl = new URL(
    '/api/workflows/draft-article/callback',
    callbackOrigin,
  ).toString();

  try {
    await dispatchDraftArticle({
      draftRunId: claim.record.id,
      specialtySlug: slug,
      articleKey,
      articleRecordId,
      callbackUrl,
      articleTitle,
      language,
      articleLength,
      fileMetadata,
      handle,
      gDriveFolderUrl,
      files,
    });
  } catch (e) {
    const msg = errorMessage(e);
    await finishArticleDraftRunAsAdmin(claim.record.id, {
      status: 'failed',
      errorMessage: `Dispatch failed: ${msg}`,
    });
    revalidateTag(`pipeline:${slug}`, 'max');
    revalidateTag(`specialty:${slug}`, 'max');
    return NextResponse.json({ error: `dispatch failed: ${msg}` }, { status: 502 });
  }

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag(`specialty:${slug}`, 'max');

  return NextResponse.json({ draftRunId: claim.record.id });
}
