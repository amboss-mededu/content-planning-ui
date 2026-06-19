import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import {
  createSpecialty,
  setSpecialtyMappingOnly,
  setSpecialtyMappingSource,
} from '@/lib/data/specialties';
import type { MappingSource } from '@/lib/types';

const MAPPING_SOURCES: readonly MappingSource[] = ['amboss', 'guidelines', 'both'];

function parseMappingSource(value: unknown): MappingSource | undefined {
  return typeof value === 'string' &&
    (MAPPING_SOURCES as readonly string[]).includes(value)
    ? (value as MappingSource)
    : undefined;
}

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
    mappingSource: parseMappingSource(args.mappingSource),
  });
  return NextResponse.json({ id });
}

/**
 * Update mutable specialty settings, flipped from the specialty-header
 * controls. Accepts either field (or both):
 *   body: { slug: string; mappingOnly?: boolean; mappingSource?: 'amboss'|'guidelines'|'both' }
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

  const hasMappingOnly = typeof args.mappingOnly === 'boolean';
  const mappingSource =
    args.mappingSource !== undefined ? parseMappingSource(args.mappingSource) : undefined;
  if (args.mappingSource !== undefined && !mappingSource) {
    return NextResponse.json(
      { error: 'mappingSource must be one of: amboss, guidelines, both' },
      { status: 400 },
    );
  }
  if (!hasMappingOnly && !mappingSource) {
    return NextResponse.json(
      { error: 'mappingOnly (boolean) or mappingSource is required' },
      { status: 400 },
    );
  }

  if (hasMappingOnly) await setSpecialtyMappingOnly(slug, args.mappingOnly as boolean);
  if (mappingSource) await setSpecialtyMappingSource(slug, mappingSource);
  return NextResponse.json({ ok: true });
}
