import { env } from '@/env';
import type { McpEnv } from '@/lib/types';

/**
 * Resolve the AMBOSS MCP server URL + token for a given per-specialty
 * environment selection. `'staging'` targets `AMBOSS_MCP_URL_STAGING` (falling
 * back to the production URL when it isn't configured); anything else uses the
 * production `AMBOSS_MCP_URL`. The token is shared across environments
 * (`AMBOSS_MCP_TOKEN`) — there is no separate staging token today.
 *
 * Centralizes what every MCP-backed step used to inline so the staging switch
 * is honored in one place (mapping, guidelines, questions, suggestions).
 */
export function resolveAmbossMcp(mcpEnv?: McpEnv): {
  url: string | undefined;
  token: string | undefined;
} {
  const url =
    mcpEnv === 'staging'
      ? (env.AMBOSS_MCP_URL_STAGING ?? env.AMBOSS_MCP_URL)
      : env.AMBOSS_MCP_URL;
  return { url, token: env.AMBOSS_MCP_TOKEN };
}
