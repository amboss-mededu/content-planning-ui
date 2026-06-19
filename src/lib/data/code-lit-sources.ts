import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { CodeLitSourceRecord, CodeRecord } from '@/lib/pb/types';

// Code/topic-level mirror of article-sources.ts — the reference corpus gathered
// per code by the RAG-corpus literature search. Keyed by the code's PB id
// (`codeId`); a re-run replaces the prior set rather than accumulating dupes.
// NOTE: backed by the `codeLitSources` collection — distinct from the unrelated
// `codeSources` code-source registry (see src/lib/data/code-sources.ts).

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/** All sources for a specialty, grouped by `codeId`, sorted by rank then title. */
export async function listCodeLitSourcesByCodeId(
  slug: string,
): Promise<Map<string, CodeLitSourceRecord[]>> {
  await connection();
  const pb = await userClient();
  const rows = await pb.collection<CodeLitSourceRecord>('codeLitSources').getFullList({
    filter: `specialtySlug = "${slug}"`,
    sort: 'rank,title',
  });
  const out = new Map<string, CodeLitSourceRecord[]>();
  for (const row of rows) {
    if (!row.codeId) continue;
    const list = out.get(row.codeId);
    if (list) list.push(row);
    else out.set(row.codeId, [row]);
  }
  return out;
}

/** Sources for a single code (PB id). Used by the detail-modal Literature tab. */
export async function listCodeLitSourcesForCodeId(
  slug: string,
  codeId: string,
): Promise<CodeLitSourceRecord[]> {
  await connection();
  if (!codeId) return [];
  const pb = await userClient();
  return pb.collection<CodeLitSourceRecord>('codeLitSources').getFullList({
    filter: `specialtySlug = "${slug}" && codeId = "${codeId}"`,
    sort: 'rank,title',
  });
}

const ALLOWED_SOURCE_FIELDS: ReadonlySet<keyof CodeLitSourceRecord> = new Set([
  'ribosomId',
  'title',
  'doi',
  'url',
  'journal',
  'journalNlm',
  'sourceType',
  'predatoryJournalRisk',
  'totalCitations',
  'impactFactor',
  'rank',
  'subtopics',
  'llmSummary',
  'justification',
  'superseded',
  'priority',
  'originalFilename',
  'geminiFilename',
  'uri',
  'mimeType',
  'cortexSourceId',
  'reviewStatus',
  'reviewerEmail',
  'reviewedAt',
  'notes',
]);

/**
 * Replace the source list for one code. Admin-side (no cookies in scope) —
 * called by the n8n callback. Deletes prior rows for the code, then inserts the
 * fresh set, projecting to the known column set and dropping null/undefined so a
 * single bad field can't 400 the whole batch.
 */
export async function bulkInsertCodeLitSourcesAsAdmin(
  slug: string,
  codeId: string,
  code: string,
  rows: Array<
    Omit<
      CodeLitSourceRecord,
      | 'id'
      | 'created'
      | 'updated'
      | 'collectionId'
      | 'collectionName'
      | 'specialtySlug'
      | 'codeId'
      | 'code'
    >
  >,
): Promise<number> {
  if (!codeId) return 0;
  const pb = await createAdminClient();
  const existing = await pb
    .collection<CodeLitSourceRecord>('codeLitSources')
    .getFullList({ filter: `specialtySlug = "${slug}" && codeId = "${codeId}"` });
  await Promise.all(
    existing.map(async (r) => {
      try {
        await pb.collection('codeLitSources').delete(r.id);
      } catch (e) {
        const status = (e as { status?: number })?.status;
        if (status !== 404) throw e;
      }
    }),
  );
  let inserted = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const payload: Record<string, unknown> = { specialtySlug: slug, codeId, code };
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) continue;
      if (ALLOWED_SOURCE_FIELDS.has(k as keyof CodeLitSourceRecord)) payload[k] = v;
    }
    try {
      await pb.collection('codeLitSources').create(payload);
      inserted++;
    } catch (e) {
      const pbErr = e as { status?: number; response?: { data?: unknown } };
      log('codeLitSources').error('insert rejected for row', {
        index: i,
        codeId,
        code,
        payload,
        pbStatus: pbErr?.status,
        pbDetail: pbErr?.response?.data,
        error: errorMessage(e),
      });
      throw e;
    }
  }
  return inserted;
}

/**
 * Stamp the denormalized lit-search result fields onto the `codes` row so the
 * mapping sheet can show a source count / status without a separate query.
 * Tolerates a missing code row (deleted between dispatch and callback).
 */
export async function updateCodeLitSearchResultAsAdmin(
  codeId: string,
  patch: {
    litSearchStatus: string;
    litSearchSourceCount?: number;
    litSearchedAt?: number;
  },
): Promise<void> {
  if (!codeId) return;
  try {
    const pb = await createAdminClient();
    await pb.collection('codes').update(codeId, patch);
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status !== 404) {
      log('codeLitSources').error('updateCodeLitSearchResultAsAdmin failed', {
        codeId,
        error: errorMessage(e),
      });
    }
  }
}

/**
 * Wipe every `codeLitSources` row for a whole specialty. Part of the
 * clean-slate cascade when code extraction is re-run.
 */
export async function deleteCodeLitSourcesForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeLitSourceRecord>('codeLitSources')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('codeLitSources').delete(r.id)));
}

/**
 * Clear the denormalized lit-search result fields on every code in a specialty,
 * so a literature_search reset doesn't leave a stale "N sources" count on the
 * mapping sheet after the underlying corpus rows are deleted.
 */
export async function clearCodeLitSearchStatusForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeRecord>('codes')
    .getFullList({ filter: `specialtySlug = "${slug}" && litSearchStatus != ""` });
  await Promise.all(
    rows.map((r) =>
      pb.collection('codes').update(r.id, {
        litSearchStatus: '',
        litSearchSourceCount: null,
        litSearchedAt: null,
      }),
    ),
  );
}
