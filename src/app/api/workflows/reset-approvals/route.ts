/**
 * Trigger endpoint for the specialty-level "Reset approvals" path.
 *
 * POST /api/workflows/reset-approvals
 *   body: { specialtySlug: string }
 *
 * Wipes downstream state (reviews, backlog, sources, writing,
 * consolidation-category-reviews, 2nd-consolidation suggestions) for a
 * specialty. Mapping and 1st consolidation are preserved — see
 * `src/lib/workflows/consolidation/reset-approvals.ts`.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { getSpecialty } from '@/lib/data/specialties';
import { resetApprovalsForSpecialty } from '@/lib/workflows/consolidation/reset-approvals';

type Body = {
  specialtySlug?: string;
};

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug;
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }
  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  try {
    const stats = await resetApprovalsForSpecialty(slug);
    revalidateTag(`specialty:${slug}`, 'max');
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    console.error('[reset-approvals] failed', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
