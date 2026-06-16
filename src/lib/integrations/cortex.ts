import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from '@/env';
import { log } from '@/lib/log';

/**
 * Client for Cortex CMS source registration. `registerCortexSource` is the
 * stable entry point Stage 2 calls; it selects a backend:
 *
 *   1. `CORTEX_MCP_URL` set → register via the MCP `createSourceEnx` tool and
 *      persist the created source's ribosomId. This is the real contract —
 *      see ./cortex-mcp.
 *   2. else `CORTEX_API_URL` set → the legacy REST `/sources` POST below.
 *   3. else → a deterministic stub ID (logs a warning), so the orchestration
 *      UX still works offline / before any backend is wired.
 *
 * Either way Cortex stores source metadata only (title, URL, authors, …) — not
 * PDFs — and the returned `cortexSourceId` is persisted on the articleSources
 * row so the final article can cite the source.
 */

export type CortexSourceMetadata = {
  /** Free-text title — used by editors when scanning the registry. */
  title: string;
  /** Source URL (typically PubMed / publisher / guideline doc). */
  url?: string;
  /** DOI without the `https://doi.org/` prefix. */
  doi?: string;
  /** Journal name. */
  journal?: string;
  /** NLM journal ID. */
  journalNlm?: string;
  /** IANA-ish source-type bucket — `guideline`, `systematic_review`, etc. */
  sourceType?: string;
  /** Original filename if known (e.g. publisher's PDF name). */
  originalFilename?: string;
  /** Free-text LLM-generated abstract. Cortex stores this as the search snippet. */
  llmSummary?: string;
  /** Specialty slug this source was first registered under — Cortex
   *  uses it for routing and access control. */
  specialtySlug: string;
};

export type CortexRegistrationResult = {
  cortexSourceId: string;
  /** True when the result came from the stub fallback. Callers should
   *  surface this so editors know the registration is local-only. */
  stub: boolean;
};

const STUB_PREFIX = 'cortex_stub_';

/**
 * Register a single source's metadata in Cortex. The returned
 * `cortexSourceId` is persisted on the `articleSources` row.
 *
 * On HTTP failure: throws. The route handler converts errors into a
 * 502 per-source outcome so a single bad upload doesn't abort the
 * batch.
 */
export async function registerCortexSource(
  meta: CortexSourceMetadata,
): Promise<CortexRegistrationResult> {
  // Preferred path: the real Cortex contract is the MCP `createSourceEnx`
  // tool. When the MCP server is configured, register through it and persist
  // the created source's ribosomId. See ./cortex-mcp.
  if (env.CORTEX_MCP_URL) {
    const { registerCortexSourceViaMcp } = await import('./cortex-mcp');
    return registerCortexSourceViaMcp(meta);
  }

  if (!env.CORTEX_API_URL) {
    const stubId = `${STUB_PREFIX}${randomUUID()}`;
    log('cortex').warn(
      `[CORTEX STUB] registerCortexSource — CORTEX_API_URL unset, returning ${stubId} for "${meta.title}"`,
    );
    return { cortexSourceId: stubId, stub: true };
  }

  const endpoint = `${env.CORTEX_API_URL.replace(/\/+$/, '')}/sources`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (env.CORTEX_API_KEY) headers.authorization = `Bearer ${env.CORTEX_API_KEY}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(meta),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cortex register failed: ${res.status} ${res.statusText} — ${text}`);
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; sourceId?: string };
  const id = body.sourceId ?? body.id;
  if (!id) {
    throw new Error(
      `Cortex register: response missing id field — ${JSON.stringify(body)}`,
    );
  }
  return { cortexSourceId: id, stub: false };
}

export function isStubCortexId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(STUB_PREFIX);
}
