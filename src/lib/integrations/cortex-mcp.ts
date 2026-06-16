import 'server-only';

import { createMCPClient } from '@ai-sdk/mcp';
import { env } from '@/env';
import { log } from '@/lib/log';
import type { CortexRegistrationResult, CortexSourceMetadata } from './cortex';

/**
 * Cortex CMS source registration over MCP.
 *
 * The real Cortex contract is the `createSourceEnx` tool exposed by the CMS's
 * MCP server (a Payload-CMS-style server). We connect with the same HTTP +
 * Bearer transport as the AMBOSS mapping client (`src/lib/workflows/lib/
 * amboss-mcp.ts`) but invoke the tool's `execute` directly — this is a
 * deterministic write, so there is NO LLM / `generateText` in the loop.
 *
 * `createSourceEnx` creates the bibliographic reference and the CMS assigns it
 * a `ribosomId`. That ribosomId is what we persist as the source's
 * `cortexSourceId`: it's the value the draft pipeline lists to the model and
 * the name it gives the matching `<ribosomId>.pdf`.
 *
 * Duplicate DOI/PMID/ISBN/term are rejected by Cortex — the same paper can
 * back several articles, so on a create failure we look the existing source up
 * by DOI and reuse its ribosomId instead of failing the registration.
 */

const CREATE_TOOL = 'createSourceEnx';
const FIND_TOOL = 'findSourcesEnx';
const FETCH_TOOL = 'fetchSourceMetadataEnx';

// Bibliographic fields `fetchSourceMetadataEnx` resolves that `createSourceEnx`
// accepts but our articleSources row does NOT store. We pass them straight
// through to Cortex so the citation is complete — they never surface in the UI.
const ENRICHMENT_KEYS = [
  'authors',
  'publicationDate',
  'publisher',
  'city',
  'volume',
  'edition',
  'pages',
] as const;

/** Cortex `sourceCategory` enum. Our internal `sourceType` buckets are finer
 *  grained (systematic_review, meta_analysis, …); everything that isn't a
 *  guideline maps to the closest Cortex bucket, `article`. */
function toSourceCategory(sourceType: string | undefined): string {
  switch (sourceType) {
    case 'guideline':
      return 'guideline';
    case 'other':
      return 'other';
    default:
      return 'article';
  }
}

function buildCreateInput(
  meta: CortexSourceMetadata,
  enrich?: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    sourceCategory: toSourceCategory(meta.sourceType),
    title: meta.title,
  };
  if (meta.doi) input.doi = meta.doi;
  if (meta.url) input.url = meta.url;
  if (meta.journal) input.journal = meta.journal;
  // Stash the LLM abstract as internal-only commentary (not shown to readers).
  if (meta.llmSummary) input.internalCommentary = meta.llmSummary;

  if (enrich) {
    // Rich-only fields the row can't hold — flow straight through to Cortex.
    for (const key of ENRICHMENT_KEYS) {
      const v = enrich[key];
      if (typeof v === 'number') input[key] = v;
      else if (typeof v === 'string' && v.trim().length > 0) input[key] = v;
    }
    // Overlapping fields: fill only where our row was empty (row value wins).
    for (const key of ['journal', 'url'] as const) {
      if (!input[key]) {
        const v = enrich[key];
        if (typeof v === 'string' && v.trim().length > 0) input[key] = v;
      }
    }
  }
  return input;
}

/** Pull the resolved `fields` object out of a `fetchSourceMetadataEnx` result
 *  (`{ success, fields: {...} }`). Returns undefined on error / missing. */
function parseFetchedFields(res: McpToolResult): Record<string, unknown> | undefined {
  if (res?.isError) return undefined;
  const parsed = parseResultJson(res);
  const fields = parsed?.fields;
  return fields && typeof fields === 'object'
    ? (fields as Record<string, unknown>)
    : undefined;
}

// MCP tool results follow the CallToolResult shape: text content plus an
// optional structured payload and an error flag.
type McpToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

function resultText(result: McpToolResult): string {
  return (result.content ?? [])
    .map((c) => (typeof c?.text === 'string' ? c.text : ''))
    .join('\n')
    .trim();
}

/** Parse the document JSON out of a CallToolResult. The Cortex tools prefix a
 *  human summary ("Collection: … Total: … Page: …") and wrap the document in a
 *  ```json fence, so a bare `JSON.parse` won't do — strip the fence (or fall
 *  back to the outermost braces) before parsing. */
function parseResultJson(result: McpToolResult): Record<string, unknown> | undefined {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = resultText(result);
  if (!text) return undefined;
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const slice = fenced ? fenced[1] : text;
  const first = slice.indexOf('{');
  const last = slice.lastIndexOf('}');
  if (first < 0 || last <= first) return undefined;
  try {
    return JSON.parse(slice.slice(first, last + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Read the source document's OWN ribosomId — top-level, or a one-level
 *  `doc`/`source`/`result` wrapper. Deliberately NOT recursive: a source
 *  payload nests *other* ribosomIds under `usedInDocuments` (the articles that
 *  cite it), and a depth-first search would return one of those by mistake. */
function sourceRibosomId(doc: Record<string, unknown> | undefined): string | undefined {
  if (!doc) return undefined;
  const wrappers: Array<Record<string, unknown> | undefined> = [
    doc,
    doc.doc as Record<string, unknown> | undefined,
    doc.source as Record<string, unknown> | undefined,
    doc.result as Record<string, unknown> | undefined,
  ];
  for (const w of wrappers) {
    const v = w?.ribosomId;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

const CALL_OPTS = { toolCallId: 'cortex-register', messages: [] };

export async function registerCortexSourceViaMcp(
  meta: CortexSourceMetadata,
): Promise<CortexRegistrationResult> {
  const url = env.CORTEX_MCP_URL;
  if (!url) throw new Error('CORTEX_MCP_URL must be set');
  const token = env.CORTEX_MCP_TOKEN;

  const mcp = await createMCPClient({
    transport: {
      type: 'http',
      url,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  });
  try {
    const tools = await mcp.tools();
    const createTool = tools[CREATE_TOOL];
    if (!createTool) {
      throw new Error(`Cortex MCP server is missing the ${CREATE_TOOL} tool`);
    }

    // Enrich with the full DOI citation before creating, so Cortex gets
    // authors/dates/volume/pages even though the row never stores them.
    let enrich: Record<string, unknown> | undefined;
    if (meta.doi) {
      const fetchTool = tools[FETCH_TOOL];
      if (fetchTool) {
        try {
          const fetched = (await fetchTool.execute(
            { identifierType: 'doi', identifier: meta.doi },
            CALL_OPTS,
          )) as McpToolResult;
          enrich = parseFetchedFields(fetched);
        } catch {
          // non-fatal — fall back to the row's own fields
        }
      }
    }

    const created = (await createTool.execute(
      buildCreateInput(meta, enrich),
      CALL_OPTS,
    )) as McpToolResult;

    if (!created?.isError) {
      const ribosomId = sourceRibosomId(parseResultJson(created));
      if (ribosomId) return { cortexSourceId: ribosomId, stub: false };
      throw new Error(
        `Cortex ${CREATE_TOOL} returned no ribosomId — ${resultText(created).slice(0, 300)}`,
      );
    }

    // Create failed. Most likely a duplicate DOI/PMID/ISBN/term. If we have a
    // DOI, reuse the existing source's ribosomId so a paper shared across
    // articles registers idempotently rather than blocking the article.
    const createError = resultText(created) || 'unknown error';
    if (meta.doi) {
      const findTool = tools[FIND_TOOL];
      if (findTool) {
        const found = (await findTool.execute(
          { where: JSON.stringify({ doi: { equals: meta.doi } }), limit: 1 },
          CALL_OPTS,
        )) as McpToolResult;
        const ribosomId = sourceRibosomId(parseResultJson(found));
        if (ribosomId) {
          log('cortex-mcp').info(
            `${CREATE_TOOL} rejected ("${createError}"); reused existing source by DOI ${meta.doi} → ribosomId ${ribosomId}`,
          );
          return { cortexSourceId: ribosomId, stub: false };
        }
      }
    }
    throw new Error(`Cortex ${CREATE_TOOL} failed: ${createError}`);
  } finally {
    try {
      await mcp.close();
    } catch {
      // non-fatal
    }
  }
}

/**
 * Look up bibliographic metadata for a DOI via the read-only
 * `fetchSourceMetadataEnx` tool. Returns the resolved `fields` object
 * (title, authors, journal, publicationDate, …) or undefined if the lookup
 * fails. Used by the per-row "Fetch DOI" button to pre-fill the table.
 */
export async function fetchSourceMetadataViaMcp(
  doi: string,
): Promise<Record<string, unknown> | undefined> {
  const url = env.CORTEX_MCP_URL;
  if (!url) throw new Error('CORTEX_MCP_URL must be set');
  const token = env.CORTEX_MCP_TOKEN;

  const mcp = await createMCPClient({
    transport: {
      type: 'http',
      url,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  });
  try {
    const tools = await mcp.tools();
    const fetchTool = tools[FETCH_TOOL];
    if (!fetchTool) return undefined;
    const fetched = (await fetchTool.execute(
      { identifierType: 'doi', identifier: doi },
      CALL_OPTS,
    )) as McpToolResult;
    return parseFetchedFields(fetched);
  } finally {
    try {
      await mcp.close();
    } catch {
      // non-fatal
    }
  }
}
