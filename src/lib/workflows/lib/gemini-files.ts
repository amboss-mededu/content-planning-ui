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
