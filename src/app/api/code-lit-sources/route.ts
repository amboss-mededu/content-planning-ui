/**
 * Read a single code's gathered literature corpus (the RAG-corpus detail-modal
 * Literature tab fetches this on demand — sources aren't carried on the table
 * row).
 *
 * GET /api/code-lit-sources?specialtySlug=<slug>&codeId=<pbId>
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { listCodeLitSourcesForCodeId } from '@/lib/data/code-lit-sources';

export async function GET(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  const slug = req.nextUrl.searchParams.get('specialtySlug')?.trim();
  const codeId = req.nextUrl.searchParams.get('codeId')?.trim();
  if (!slug || !codeId) {
    return NextResponse.json(
      { error: 'specialtySlug and codeId are required' },
      { status: 400 },
    );
  }

  const sources = await listCodeLitSourcesForCodeId(slug, codeId);
  return NextResponse.json({ sources });
}
