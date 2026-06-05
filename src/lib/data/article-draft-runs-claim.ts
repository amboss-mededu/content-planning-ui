import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import type { ArticleDraftRunRecord } from '@/lib/pb/types';

export type DraftRunClaim =
  | { claimed: true; record: ArticleDraftRunRecord }
  | { claimed: false; reason: 'already_running'; record: ArticleDraftRunRecord };

/**
 * Atomically claim the single active draft slot for an article. The
 * `articleDraftRuns` partial unique index `(specialtySlug, articleKey)
 * WHERE status = "running"` makes the create fail if a draft is already in
 * flight — we catch that and return the existing row instead of starting a
 * duplicate n8n job. Mirrors `claimArticleLitSearchRunWithClient`.
 */
export async function claimArticleDraftRunWithClient(
  pb: Pick<PocketBase, 'collection'>,
  input: {
    specialtySlug: string;
    articleKey: string;
    articleRecordId: string;
    handle?: string;
    language?: string;
    articleLength?: string;
  },
): Promise<DraftRunClaim> {
  const payload = {
    specialtySlug: input.specialtySlug,
    articleKey: input.articleKey,
    articleRecordId: input.articleRecordId,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    errorMessage: '',
    handle: input.handle ?? '',
    language: input.language ?? '',
    articleLength: input.articleLength ?? '',
    outputUrl: '',
  };
  try {
    const record = await pb
      .collection<ArticleDraftRunRecord>('articleDraftRuns')
      .create(payload);
    return { claimed: true, record };
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e;
    const existing = await pb
      .collection<ArticleDraftRunRecord>('articleDraftRuns')
      .getFirstListItem(
        `specialtySlug = "${input.specialtySlug}" && articleKey = "${input.articleKey}" && status = "running"`,
      );
    return { claimed: false, reason: 'already_running', record: existing };
  }
}

function isUniqueConstraintError(e: unknown): boolean {
  if (!(e instanceof ClientResponseError) && !hasStatus(e)) return false;
  if ((e as { status?: number }).status !== 400) return false;
  const text = JSON.stringify(
    (e as { response?: unknown; data?: unknown; message?: unknown }).response ??
      (e as { data?: unknown }).data ??
      (e as { message?: unknown }).message,
  ).toLowerCase();
  return text.includes('unique') || text.includes('constraint');
}

function hasStatus(e: unknown): e is { status: number } {
  return (
    !!e && typeof e === 'object' && typeof (e as { status?: unknown }).status === 'number'
  );
}
