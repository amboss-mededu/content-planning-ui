import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import type { ArticleLitSearchRunRecord } from '@/lib/pb/types';

export type LitSearchRunClaim =
  | { claimed: true; record: ArticleLitSearchRunRecord }
  | { claimed: false; reason: 'already_running'; record: ArticleLitSearchRunRecord };

export async function claimArticleLitSearchRunWithClient(
  pb: Pick<PocketBase, 'collection'>,
  input: {
    specialtySlug: string;
    articleKey: string;
    articleRecordId: string;
    runId?: string;
  },
): Promise<LitSearchRunClaim> {
  const payload = {
    specialtySlug: input.specialtySlug,
    articleKey: input.articleKey,
    articleRecordId: input.articleRecordId,
    runId: input.runId ?? '',
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    errorMessage: '',
    queryCount: 0,
    candidateCount: 0,
    sourcesCount: 0,
  };
  try {
    const record = await pb
      .collection<ArticleLitSearchRunRecord>('articleLitSearchRuns')
      .create(payload);
    return { claimed: true, record };
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e;
    const existing = await pb
      .collection<ArticleLitSearchRunRecord>('articleLitSearchRuns')
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
