import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import { createCodeSource, removeCodeSource } from '@/lib/data/code-sources';
import { parseBodyOr400 } from '@/lib/http/parse-body';

const Body = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(request, Body);
  if (body instanceof NextResponse) return body;
  const slug = (body.slug ?? '').trim();
  const name = (body.name ?? '').trim();
  if (!slug || !name) {
    return NextResponse.json({ error: 'slug + name required' }, { status: 400 });
  }
  const id = await createCodeSource(slug, name);
  return NextResponse.json({ id });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const slug = request.nextUrl.searchParams.get('slug')?.trim() ?? '';
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }
  await removeCodeSource(slug);
  return NextResponse.json({ ok: true });
}
