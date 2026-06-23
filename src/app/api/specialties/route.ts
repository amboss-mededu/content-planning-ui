import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import {
  createSpecialty,
  setSpecialtyMappingOnly,
  setSpecialtyMappingSource,
  setSpecialtyPipelineMode,
} from '@/lib/data/specialties';
import type { MappingSource, PipelineMode } from '@/lib/types';

const MAPPING_SOURCES: readonly MappingSource[] = ['amboss', 'guidelines', 'both'];
const PIPELINE_MODES: readonly PipelineMode[] = ['full', 'mapping-only', 'rag-corpus'];

function parseMappingSource(value: unknown): MappingSource | undefined {
  return typeof value === 'string' &&
    (MAPPING_SOURCES as readonly string[]).includes(value)
    ? (value as MappingSource)
    : undefined;
}

function parsePipelineMode(value: unknown): PipelineMode | undefined {
  return typeof value === 'string' &&
    (PIPELINE_MODES as readonly string[]).includes(value)
    ? (value as PipelineMode)
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
  const pipelineMode = parsePipelineMode(args.pipelineMode);
  // rag-corpus always maps against guidelines — pin it server-side regardless
  // of what the client sent.
  const mappingSource =
    pipelineMode === 'rag-corpus' ? 'guidelines' : parseMappingSource(args.mappingSource);
  const id = await createSpecialty({
    slug,
    name,
    source,
    sheetId: typeof args.sheetId === 'string' ? args.sheetId : undefined,
    xlsxPath: typeof args.xlsxPath === 'string' ? args.xlsxPath : undefined,
    region: typeof args.region === 'string' ? args.region : undefined,
    language: typeof args.language === 'string' ? args.language : undefined,
    mappingOnly: typeof args.mappingOnly === 'boolean' ? args.mappingOnly : undefined,
    mappingSource,
    pipelineMode,
  });
  return NextResponse.json({ id });
}

/**
 * Update mutable specialty settings, flipped from the specialty settings modal.
 * Accepts any of these fields (at least one required):
 *   body: {
 *     slug: string;
 *     pipelineMode?: 'full'|'mapping-only'|'rag-corpus';
 *     mappingOnly?: boolean;          // legacy; superseded by pipelineMode
 *     mappingSource?: 'amboss'|'guidelines'|'both';
 *   }
 * Switching to 'rag-corpus' also pins the mapping source to 'guidelines'.
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
  const pipelineMode =
    args.pipelineMode !== undefined ? parsePipelineMode(args.pipelineMode) : undefined;
  if (args.pipelineMode !== undefined && !pipelineMode) {
    return NextResponse.json(
      { error: 'pipelineMode must be one of: full, mapping-only, rag-corpus' },
      { status: 400 },
    );
  }
  if (!hasMappingOnly && !mappingSource && !pipelineMode) {
    return NextResponse.json(
      { error: 'pipelineMode, mappingOnly (boolean), or mappingSource is required' },
      { status: 400 },
    );
  }

  if (pipelineMode) await setSpecialtyPipelineMode(slug, pipelineMode);
  if (hasMappingOnly) await setSpecialtyMappingOnly(slug, args.mappingOnly as boolean);
  // rag-corpus pins the source to guidelines, overriding any explicit source.
  const effectiveSource = pipelineMode === 'rag-corpus' ? 'guidelines' : mappingSource;
  if (effectiveSource) await setSpecialtyMappingSource(slug, effectiveSource);
  return NextResponse.json({ ok: true });
}
