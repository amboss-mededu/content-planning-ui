/**
 * Minimal client for the Gemini Files API.
 *
 * Uploads a PDF (or any binary) to Google's Generative AI Files API and
 * returns the URI to attach as a `fileData` part on a subsequent
 * `generateText` call. We use raw fetch with the documented resumable
 * upload protocol — no extra SDK dependency.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/document-processing#large
 *
 * The returned URI is short-lived (~48h per Google's docs) — re-upload
 * before re-running a draft if the file has expired.
 */

const FILES_BASE = 'https://generativelanguage.googleapis.com';

export type UploadedGeminiFile = {
  /** `files/abc-xyz` — the resource name. */
  name: string;
  /** Display label set on upload — usually the original filename. */
  displayName: string;
  /** IANA media type as Google echoed it back. */
  mimeType: string;
  /** Full file URI — pass to `generateText` as a FilePart's `data`. */
  uri: string;
  /** Unix-seconds expiration. After this, the upload is gone. */
  expirationTime: number;
};

export async function uploadPdfToGemini(input: {
  apiKey: string;
  bytes: Uint8Array | ArrayBuffer;
  mimeType: string;
  displayName: string;
}): Promise<UploadedGeminiFile> {
  const bytes =
    input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const startUrl = `${FILES_BASE}/upload/v1beta/files?key=${encodeURIComponent(input.apiKey)}`;

  // Step 1: resumable upload start. We send the metadata as JSON and
  // get back an X-Goog-Upload-URL we PUT the bytes to.
  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': input.mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: input.displayName } }),
  });
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => '');
    throw new Error(
      `Gemini Files start failed: ${startRes.status} ${startRes.statusText} — ${text}`,
    );
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini Files start did not return an upload URL.');
  }

  // Step 2: upload bytes + finalize in one request.
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    // Cast away — fetch in undici / Node 24 accepts Uint8Array but the
    // typings here are conservative.
    body: bytes as BodyInit,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '');
    throw new Error(
      `Gemini Files upload failed: ${uploadRes.status} ${uploadRes.statusText} — ${text}`,
    );
  }
  const body = (await uploadRes.json()) as {
    file?: {
      name?: string;
      displayName?: string;
      mimeType?: string;
      uri?: string;
      expirationTime?: string;
    };
  };
  const file = body.file;
  if (!file?.uri || !file.name || !file.mimeType) {
    throw new Error(`Gemini Files response missing fields: ${JSON.stringify(body)}`);
  }

  return {
    name: file.name,
    displayName: file.displayName ?? input.displayName,
    mimeType: file.mimeType,
    uri: file.uri,
    expirationTime: file.expirationTime
      ? Math.floor(Date.parse(file.expirationTime) / 1000)
      : 0,
  };
}

/**
 * Best-effort delete a previously uploaded file. Used when re-uploading
 * to swap out an expired URI. Errors are swallowed — the file may have
 * already expired or never existed.
 */
export async function deleteGeminiFile(apiKey: string, name: string): Promise<void> {
  if (!name) return;
  const url = `${FILES_BASE}/v1beta/${name}?key=${encodeURIComponent(apiKey)}`;
  try {
    await fetch(url, { method: 'DELETE' });
  } catch {
    /* swallow — best-effort cleanup */
  }
}

// --- JIT per-article ensure-uploaded ---------------------------------------

import {
  listArticleSourcesForArticleAsAdmin,
  markSourceUploadedAsAdmin,
} from '@/lib/data/article-sources';

export type EnsureUploadOutcome = {
  sourceId: string;
  title: string;
  status: 'uploaded' | 'reused' | 'failed' | 'no-url';
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
  const ct = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
  const mimeType = ct.startsWith('application/') ? ct : 'application/pdf';
  return { bytes: new Uint8Array(buf), mimeType };
}

/**
 * Internal helper called by the writing workflow at the start of each
 * run. Walks the article's source rows, fetches each PDF from
 * `source.url`, uploads to Gemini Files API, persists `{ uri,
 * mimeType, geminiFilename }` back on the row.
 *
 * Reuses a previously-uploaded URI when it was stamped within the
 * last `cacheMaxAgeMs` (default 24h; Files API URIs expire after 48h,
 * so we re-upload conservatively).
 *
 * Throws only on missing API key. Per-source failures are recorded as
 * outcomes — the writing workflow proceeds with whatever PDFs are
 * available, and the LLM passes that don't need a PDF still run.
 */
export async function ensureGeminiUploadsForArticle(input: {
  apiKey: string;
  specialtySlug: string;
  articleRecordId: string;
  cacheMaxAgeMs?: number;
}): Promise<{
  outcomes: EnsureUploadOutcome[];
  counts: { uploaded: number; reused: number; failed: number; noUrl: number };
}> {
  const maxAge = input.cacheMaxAgeMs ?? 24 * 60 * 60 * 1000;
  const now = Date.now();
  const sources = await listArticleSourcesForArticleAsAdmin(
    input.specialtySlug,
    input.articleRecordId,
  );

  const outcomes: EnsureUploadOutcome[] = [];
  for (const s of sources) {
    const cachedAt = s.updated ? Date.parse(s.updated) : 0;
    if (s.uri && cachedAt > 0 && now - cachedAt < maxAge) {
      outcomes.push({ sourceId: s.id, title: s.title, status: 'reused', uri: s.uri });
      continue;
    }
    if (!s.url) {
      outcomes.push({ sourceId: s.id, title: s.title, status: 'no-url' });
      continue;
    }
    try {
      const { bytes, mimeType } = await fetchPdfBytes(s.url);
      const uploaded = await uploadPdfToGemini({
        apiKey: input.apiKey,
        bytes,
        mimeType,
        displayName: s.originalFilename || `${s.title}.pdf`,
      });
      await markSourceUploadedAsAdmin(s.id, {
        uri: uploaded.uri,
        mimeType: uploaded.mimeType,
        geminiFilename: uploaded.name,
      });
      outcomes.push({
        sourceId: s.id,
        title: s.title,
        status: 'uploaded',
        uri: uploaded.uri,
      });
    } catch (e) {
      outcomes.push({
        sourceId: s.id,
        title: s.title,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    outcomes,
    counts: {
      uploaded: outcomes.filter((o) => o.status === 'uploaded').length,
      reused: outcomes.filter((o) => o.status === 'reused').length,
      failed: outcomes.filter((o) => o.status === 'failed').length,
      noUrl: outcomes.filter((o) => o.status === 'no-url').length,
    },
  };
}
