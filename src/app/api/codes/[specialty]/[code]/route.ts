/**
 * Per-code edit endpoint.
 *
 * PATCH /api/codes/[specialty]/[code]
 *   body: { description?, category?, consolidationCategory? }
 *
 * Gated on consolidation state — returns 409 if `consolidate_primary` is in
 * any state other than `pending`/`skipped`. The gate is also enforced in the
 * UI, but re-checked here so a stale tab can't bypass it.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { ClientResponseError } from 'pocketbase';
import { requireUserResponse } from '@/lib/auth';
import { getCode, patchCode } from '@/lib/data/codes';
import { getConsolidationLockState } from '@/lib/data/pipeline';

type Body = {
  description?: string | null;
  category?: string | null;
  consolidationCategory?: string | null;
};

function cleanOpt(v: unknown): string | undefined {
  // Treat `null` and empty strings as no-ops — the UI doesn't expose a
  // clear action, so we forward only meaningful, trimmed values.
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ specialty: string; code: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty, code } = await params;
  const slug = decodeURIComponent(specialty);
  const codeId = decodeURIComponent(code);

  const row = await getCode(slug, codeId);
  if (!row) return NextResponse.json({ error: 'code not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ specialty: string; code: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty, code } = await params;
  const slug = decodeURIComponent(specialty);
  const codeId = decodeURIComponent(code);

  const lock = await getConsolidationLockState(slug);
  if (lock.locked) {
    return NextResponse.json(
      {
        error: 'Consolidation is active — reset the consolidation stage to edit codes.',
      },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const description = cleanOpt(body.description);
  const category = cleanOpt(body.category);
  const consolidationCategory = cleanOpt(body.consolidationCategory);
  const fields: {
    description?: string;
    category?: string;
    consolidationCategory?: string;
  } = {};
  if (description !== undefined) fields.description = description;
  if (category !== undefined) fields.category = category;
  if (consolidationCategory !== undefined)
    fields.consolidationCategory = consolidationCategory;
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'no editable fields supplied' }, { status: 400 });
  }
  console.log('[codes] PATCH', { slug, code: codeId, fields });

  try {
    await patchCode(slug, codeId, fields);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      return NextResponse.json({ error: 'code not found' }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[codes] PATCH failed:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
