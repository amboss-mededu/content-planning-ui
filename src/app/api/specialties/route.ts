import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { createSpecialty, setSpecialtyMappingOnly } from '@/lib/data/specialties';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireUserResponse();
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }
  const args = body as Record<string, unknown>;
  const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const source = typeof args.source === 'string' ? args.source.trim() : '';
  if (!slug || !name || !source) {
    return NextResponse.json(
      { error: 'slug, name, and source are required' },
      { status: 400 },
    );
  }
  const id = await createSpecialty({
    slug,
    name,
    source,
    sheetId: typeof args.sheetId === 'string' ? args.sheetId : undefined,
    xlsxPath: typeof args.xlsxPath === 'string' ? args.xlsxPath : undefined,
    region: typeof args.region === 'string' ? args.region : undefined,
    language: typeof args.language === 'string' ? args.language : undefined,
    mappingOnly: typeof args.mappingOnly === 'boolean' ? args.mappingOnly : undefined,
  });
  return NextResponse.json({ id });
}

/**
 * Update mutable specialty settings. Currently only the `mappingOnly` mode,
 * flipped from the specialty-header toggle.
 *   body: { slug: string; mappingOnly: boolean }
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const guard = await requireUserResponse();
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }
  const args = body as Record<string, unknown>;
  const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }
  if (typeof args.mappingOnly !== 'boolean') {
    return NextResponse.json(
      { error: 'mappingOnly (boolean) is required' },
      { status: 400 },
    );
  }
  await setSpecialtyMappingOnly(slug, args.mappingOnly);
  return NextResponse.json({ ok: true });
}
