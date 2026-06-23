import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import type { CodeLitSearchRunRecord } from '@/lib/pb/types';

// Code/topic-level mirror of article-lit-search-runs-claim.ts. The partial
// unique index `(specialtySlug, codeId) WHERE status = "running"` makes the
// create the atomic claim: a concurrent second attempt hits the constraint and
// resolves to `already_running`.

export type CodeLitSearchRunClaim =
  | { claimed: true; record: CodeLitSearchRunRecord }
  | { claimed: false; reason: 'already_running'; record: CodeLitSearchRunRecord };

export async function claimCodeLitSearchRunWithClient(
  pb: Pick<PocketBase, 'collection'>,
  input: {
    specialtySlug: string;
    codeId: string;
    code?: string;
    runId?: string;
  },
): Promise<CodeLitSearchRunClaim> {
  const payload = {
    specialtySlug: input.specialtySlug,
    codeId: input.codeId,
    code: input.code ?? '',
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
      .collection<CodeLitSearchRunRecord>('codeLitSearchRuns')
      .create(payload);
    return { claimed: true, record };
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e;
    const existing = await pb
      .collection<CodeLitSearchRunRecord>('codeLitSearchRuns')
      .getFirstListItem(
        `specialtySlug = "${input.specialtySlug}" && codeId = "${input.codeId}" && status = "running"`,
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
