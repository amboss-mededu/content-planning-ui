/**
 * Dispatches an article-drafting job to the n8n webhook.
 *
 * Unlike literature-search (JSON), this POSTs multipart/form-data because
 * the n8n workflow consumes the source PDFs as file uploads — each named
 * `<ribosomId>.pdf`. n8n owns the heavy work (the multi-pass LLM draft) and
 * writes the result to a Google Drive folder; the webhook is configured to
 * respond immediately. When n8n finishes it calls back to
 * /api/workflows/draft-article/callback with the resulting doc URL.
 *
 * The callback plumbing (`callbackUrl`, `callbackToken`, `meta`) rides along
 * as extra form fields the workflow forwards to its final HTTP Request node.
 */

import { env } from '@/env';

export type DispatchDraftArticleInput = {
  draftRunId: string;
  specialtySlug: string;
  articleKey: string;
  articleRecordId: string;
  callbackUrl: string;
  articleTitle: string;
  language: string;
  articleLength: string;
  /** Numbered, priority-ordered ribosomId list (the n8n `fileMetadata`). */
  fileMetadata: string;
  handle: string;
  gDriveFolderUrl?: string;
  /** Source PDFs, each already named `<ribosomId>.pdf`. */
  files: File[];
};

export async function dispatchDraftArticle(
  input: DispatchDraftArticleInput,
): Promise<void> {
  const webhookUrl = env.DRAFT_ARTICLE_N8N_WEBHOOK_URL;
  const callbackToken = env.N8N_CALLBACK_SECRET;
  if (!webhookUrl) throw new Error('DRAFT_ARTICLE_N8N_WEBHOOK_URL is not configured');
  if (!callbackToken) throw new Error('N8N_CALLBACK_SECRET is not configured');

  const form = new FormData();
  // Mirror the n8n form fields verbatim.
  form.set('articleTitle', input.articleTitle);
  form.set('language', input.language);
  form.set('articleLength', input.articleLength);
  form.set('fileMetadata', input.fileMetadata);
  form.set('handle', input.handle);
  form.set('gDriveFolderUrl', input.gDriveFolderUrl ?? '');
  // Callback plumbing — the workflow echoes these to its final HTTP node so
  // it can POST results back to us with the right URL + bearer token.
  form.set('callbackUrl', input.callbackUrl);
  form.set('callbackToken', callbackToken);
  form.set(
    'meta',
    JSON.stringify({
      draftRunId: input.draftRunId,
      articleRecordId: input.articleRecordId,
      articleKey: input.articleKey,
      specialtySlug: input.specialtySlug,
    }),
  );
  for (const file of input.files) {
    // Preserve the `<ribosomId>.pdf` filename so n8n can correlate each PDF
    // with its priority entry in fileMetadata.
    form.append('files', file, file.name);
  }

  // Do NOT set content-type: fetch derives the multipart boundary from the
  // FormData body. Setting it manually would break parsing on the n8n side.
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      // Outbound Header Auth — credential Name = `X-Draft-Article-Auth`,
      // Value = DRAFT_ARTICLE_N8N_AUTH_SECRET. Omitted when unset.
      ...(env.DRAFT_ARTICLE_N8N_AUTH_SECRET
        ? { 'X-Draft-Article-Auth': env.DRAFT_ARTICLE_N8N_AUTH_SECRET }
        : {}),
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`n8n responded ${res.status} ${res.statusText}`);
  }
}
