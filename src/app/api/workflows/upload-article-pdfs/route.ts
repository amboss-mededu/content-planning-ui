/**
 * Upload an article's source PDFs to the Gemini Files API and stamp
 * each `articleSources` row with the resulting URI.
 *
 * POST /api/workflows/upload-article-pdfs
 *   body: {
 *     specialtySlug: string;
 *     articleRecordId: string;
 *   }
 *
 * Walks every source attached to the article that doesn't yet have a
 * `uri` set, downloads the PDF from `source.url`, uploads to Gemini
 * Files API, persists `{ uri, mimeType, geminiFilename }` back to the
 * row. Idempotent — sources that already have a URI are skipped, so
 * the editor can click "Upload sources" repeatedly to recover from a
 * partial failure.
 *
 * The Files API URI is short-lived (~48h per Google's docs). Re-run
 * the upload before kicking off `write-article` if a previous upload
 * has expired.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import {
  listArticleSourcesForArticleAsAdmin,
  markSourceUploadedAsAdmin,
} from '@/lib/data/article-sources';
import { getSpecialty } from '@/lib/data/specialties';
import { uploadPdfToGemini } from '@/lib/workflows/lib/gemini-files';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';

type Body = {
  specialtySlug?: string;
  articleRecordId?: string;
};

type UploadOutcome = {
  sourceId: string;
  title: string;
  status: 'uploaded' | 'skipped' | 'failed';
  uri?: string;
  error?: string;
};

async function fetchPdfBytes(
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`source URL ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  // Trust the server's reported type; fall back to application/pdf so
  // Gemini accepts the upload even for sites that send octet-stream.
  const ct = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
  const mimeType = ct.startsWith('application/') ? ct : 'application/pdf';
  return { bytes: new Uint8Array(buf), mimeType };
}

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug?.trim();
  const articleRecordId = body.articleRecordId?.trim();
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }
  if (!articleRecordId) {
    return NextResponse.json({ error: 'articleRecordId required' }, { status: 400 });
  }

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const apiKeys = await resolveApiKeysForRun(['google']);
  const googleKey = apiKeys.google;
  if (!googleKey) {
    return NextResponse.json(
      {
        error: 'No Google API key configured. Settings → API keys → Google.',
        code: 'MISSING_API_KEY',
        provider: 'google',
      },
      { status: 409 },
    );
  }

  const sources = await listArticleSourcesForArticleAsAdmin(slug, articleRecordId);
  if (sources.length === 0) {
    return NextResponse.json(
      { error: 'No sources attached to this article.', code: 'NO_SOURCES' },
      { status: 409 },
    );
  }

  const outcomes: UploadOutcome[] = [];
  for (const source of sources) {
    if (source.uri) {
      outcomes.push({
        sourceId: source.id,
        title: source.title,
        status: 'skipped',
        uri: source.uri,
      });
      continue;
    }
    if (!source.url) {
      outcomes.push({
        sourceId: source.id,
        title: source.title,
        status: 'failed',
        error: 'source has no url',
      });
      continue;
    }
    try {
      const { bytes, mimeType } = await fetchPdfBytes(source.url);
      const uploaded = await uploadPdfToGemini({
        apiKey: googleKey,
        bytes,
        mimeType,
        displayName: source.originalFilename || `${source.title}.pdf`,
      });
      await markSourceUploadedAsAdmin(source.id, {
        uri: uploaded.uri,
        mimeType: uploaded.mimeType,
        geminiFilename: uploaded.name,
      });
      outcomes.push({
        sourceId: source.id,
        title: source.title,
        status: 'uploaded',
        uri: uploaded.uri,
      });
    } catch (e) {
      outcomes.push({
        sourceId: source.id,
        title: source.title,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const counts = {
    uploaded: outcomes.filter((o) => o.status === 'uploaded').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  };

  return NextResponse.json({ counts, outcomes });
}
