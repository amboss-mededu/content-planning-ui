import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import {
  createSpecialty,
  getSpecialty,
  setSpecialtyMappingOnly,
  setSpecialtyMappingSource,
  setSpecialtyMcpEnv,
  setSpecialtyPipelineMode,
} from '@/lib/data/specialties';
import type { MappingSource, McpEnv, PipelineMode } from '@/lib/types';

const MAPPING_SOURCES: readonly MappingSource[] = ['amboss', 'guidelines', 'both'];
const MCP_ENVS: readonly McpEnv[] = ['production', 'staging'];
const PIPELINE_MODES: readonly PipelineMode[] = [
  'full',
  'mapping-only',
  'rag-corpus',
  'curriculum-mapping',
];

/**
 * Modes that pin the mapping source server-side, overriding whatever the client
 * sent: `curriculum-mapping` always assesses coverage against AMBOSS. (RAG corpus
 * is no longer pinned — it lets the user choose RAG DB / AMBOSS / both.)
 */
const FORCED_SOURCE: Partial<Record<PipelineMode, MappingSource>> = {
  'curriculum-mapping': 'amboss',
};

function parseMappingSource(value: unknown): MappingSource | undefined {
  return typeof value === 'string' &&
    (MAPPING_SOURCES as readonly string[]).includes(value)
    ? (value as MappingSource)
    : undefined;
}

function parseMcpEnv(value: unknown): McpEnv | undefined {
  return typeof value === 'string' && (MCP_ENVS as readonly string[]).includes(value)
    ? (value as McpEnv)
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
  // Reject duplicates instead of silently upserting over an existing specialty.
  // The unique index on `slug` is the backstop; this gives a friendly message.
  if (await getSpecialty(slug)) {
    return NextResponse.json(
      { error: 'A specialty with that slug already exists.' },
      { status: 409 },
    );
  }
  const pipelineMode = parsePipelineMode(args.pipelineMode);
  // Some modes pin the mapping source server-side (curriculum-mapping → amboss)
  // regardless of what the client sent.
  const forced = pipelineMode ? FORCED_SOURCE[pipelineMode] : undefined;
  const mappingSource = forced ?? parseMappingSource(args.mappingSource);
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
    mcpEnv: parseMcpEnv(args.mcpEnv),
  });
  return NextResponse.json({ id });
}

/**
 * Update mutable specialty settings, flipped from the specialty settings modal.
 * Accepts any of these fields (at least one required):
 *   body: {
 *     slug: string;
 *     pipelineMode?: 'full'|'mapping-only'|'rag-corpus'|'curriculum-mapping';
 *     mappingOnly?: boolean;          // legacy; superseded by pipelineMode
 *     mappingSource?: 'amboss'|'guidelines'|'both';
 *   }
 * Switching to 'rag-corpus' pins the mapping source to 'guidelines';
 * 'curriculum-mapping' pins it to 'amboss'.
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
      {
        error:
          'pipelineMode must be one of: full, mapping-only, rag-corpus, curriculum-mapping',
      },
      { status: 400 },
    );
  }
  const mcpEnv = args.mcpEnv !== undefined ? parseMcpEnv(args.mcpEnv) : undefined;
  if (args.mcpEnv !== undefined && !mcpEnv) {
    return NextResponse.json(
      { error: 'mcpEnv must be one of: production, staging' },
      { status: 400 },
    );
  }
  if (!hasMappingOnly && !mappingSource && !pipelineMode && !mcpEnv) {
    return NextResponse.json(
      {
        error:
          'pipelineMode, mappingOnly (boolean), mappingSource, or mcpEnv is required',
      },
      { status: 400 },
    );
  }

  if (pipelineMode) await setSpecialtyPipelineMode(slug, pipelineMode);
  if (hasMappingOnly) await setSpecialtyMappingOnly(slug, args.mappingOnly as boolean);
  // Modes that pin the source (curriculum-mapping → amboss) override any
  // explicit source the client sent.
  const effectiveSource =
    (pipelineMode ? FORCED_SOURCE[pipelineMode] : undefined) ?? mappingSource;
  if (effectiveSource) await setSpecialtyMappingSource(slug, effectiveSource);
  if (mcpEnv) await setSpecialtyMcpEnv(slug, mcpEnv);
  return NextResponse.json({ ok: true });
}
