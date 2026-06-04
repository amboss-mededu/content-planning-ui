import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

const optionalString = z.string().min(1).optional();

const sheetIdsSchema = z
  .string()
  .optional()
  .default('{}')
  .transform((raw, ctx) => {
    if (!raw || raw.trim() === '') return {} as Record<string, string>;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
      ctx.addIssue({
        code: 'custom',
        message: 'MAPPING_SHEET_IDS must be a JSON object',
      });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'MAPPING_SHEET_IDS must be valid JSON' });
    }
    return z.NEVER;
  });

const xlsxFixturesSchema = z
  .string()
  .optional()
  .transform((raw) => {
    if (!raw || raw.trim() === '') return {} as Record<string, string>;
    const entries: Array<[string, string]> = [];
    for (const pair of raw.split(',')) {
      const [slug, ...rest] = pair.split(':');
      const path = rest.join(':').trim();
      if (slug && path) entries.push([slug.trim(), path]);
    }
    return Object.fromEntries(entries);
  });

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    GOOGLE_SA_CLIENT_EMAIL: optionalString,
    GOOGLE_SA_PRIVATE_KEY: optionalString.transform((s) => s?.replace(/\\n/g, '\n')),
    MAPPING_SHEET_IDS: sheetIdsSchema,
    LOCAL_XLSX_FIXTURES: xlsxFixturesSchema,
    AMBOSS_MCP_URL: z.string().url().optional(),
    AMBOSS_MCP_TOKEN: optionalString,
    GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    POCKETBASE_URL: optionalString,
    POCKETBASE_ADMIN_EMAIL: optionalString,
    POCKETBASE_ADMIN_PASSWORD: optionalString,
    GOOGLE_OAUTH_CLIENT_ID: optionalString,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
    // Dev-only auto-login. When set in development mode, the proxy redirects
    // unauthenticated requests to /api/auth/dev-autologin (instead of /login),
    // which mints a session for this email via the PB impersonate API. Useful
    // when OAuth credentials aren't provisioned yet. Ignored in production.
    DEV_AUTOLOGIN_EMAIL: optionalString,
    // Cortex CMS source-registration API. When unset, the Stage 2
    // workflow returns a deterministic stub ID and logs a warning —
    // unblocks the orchestration UX before the API contract is final.
    CORTEX_API_URL: z.string().url().optional(),
    CORTEX_API_KEY: optionalString,
    // n8n webhook that owns the literature-search pipeline (query gen +
    // PubMed + ranking). The app POSTs per-article jobs and listens on
    // /api/workflows/literature-search/callback for results — see
    // src/lib/workflows/literature-search/dispatch.ts.
    LIT_SEARCH_N8N_WEBHOOK_URL: z.string().url().optional(),
    // Header Auth secret for the outbound trigger. Sent as the
    // `X-Lit-Search-Auth` header value when POSTing to the n8n webhook, and
    // configured as the "Value" of the webhook node's Header Auth credential
    // (its "Name" is the constant `X-Lit-Search-Auth`). Distinct from the
    // inbound CALLBACK_SECRET below. Generate with `openssl rand -hex 32`.
    LIT_SEARCH_N8N_AUTH_SECRET: optionalString,
    // Shared secret. Sent to n8n in the trigger payload's meta.callbackToken
    // and required as `Authorization: Bearer <secret>` on inbound callbacks.
    // Shared by every n8n workflow's callback route. Generate with
    // `openssl rand -hex 32`.
    N8N_CALLBACK_SECRET: optionalString,
    // Optional override for the origin n8n calls back on. Unset in production
    // (the trigger routes derive it from req.nextUrl.origin); for local dev
    // point it at a tunnel URL (e.g. cloudflared) since n8n Cloud can't reach
    // localhost. Shared by every n8n workflow.
    N8N_CALLBACK_BASE_URL: z.string().url().optional(),
    // n8n webhook that owns article drafting (the "Draft Article" action).
    // The app POSTs a multipart/form-data job (article metadata + source PDFs)
    // and listens on /api/workflows/draft-article/callback for the resulting
    // Google Drive doc URL — see src/lib/workflows/draft-article/dispatch.ts.
    DRAFT_ARTICLE_N8N_WEBHOOK_URL: z.string().url().optional(),
    // Header Auth secret for the outbound draft-article trigger. Sent as the
    // `X-Draft-Article-Auth` header value when POSTing to the n8n webhook, and
    // configured as the "Value" of that webhook node's Header Auth credential
    // (its "Name" is the constant `X-Draft-Article-Auth`). Distinct from the
    // shared CALLBACK_SECRET. Generate with `openssl rand -hex 32`.
    DRAFT_ARTICLE_N8N_AUTH_SECRET: optionalString,
  },
  client: {
    NEXT_PUBLIC_POCKETBASE_URL: z.string().url().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_SA_CLIENT_EMAIL: process.env.GOOGLE_SA_CLIENT_EMAIL,
    GOOGLE_SA_PRIVATE_KEY: process.env.GOOGLE_SA_PRIVATE_KEY,
    MAPPING_SHEET_IDS: process.env.MAPPING_SHEET_IDS,
    LOCAL_XLSX_FIXTURES: process.env.LOCAL_XLSX_FIXTURES,
    AMBOSS_MCP_URL: process.env.AMBOSS_MCP_URL,
    AMBOSS_MCP_TOKEN: process.env.AMBOSS_MCP_TOKEN,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    POCKETBASE_URL: process.env.POCKETBASE_URL,
    POCKETBASE_ADMIN_EMAIL: process.env.POCKETBASE_ADMIN_EMAIL,
    POCKETBASE_ADMIN_PASSWORD: process.env.POCKETBASE_ADMIN_PASSWORD,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    DEV_AUTOLOGIN_EMAIL: process.env.DEV_AUTOLOGIN_EMAIL,
    CORTEX_API_URL: process.env.CORTEX_API_URL,
    CORTEX_API_KEY: process.env.CORTEX_API_KEY,
    NEXT_PUBLIC_POCKETBASE_URL: process.env.NEXT_PUBLIC_POCKETBASE_URL,
    N8N_CALLBACK_SECRET: process.env.N8N_CALLBACK_SECRET,
    N8N_CALLBACK_BASE_URL: process.env.N8N_CALLBACK_BASE_URL,
    LIT_SEARCH_N8N_WEBHOOK_URL: process.env.LIT_SEARCH_N8N_WEBHOOK_URL,
    LIT_SEARCH_N8N_AUTH_SECRET: process.env.LIT_SEARCH_N8N_AUTH_SECRET,
    DRAFT_ARTICLE_N8N_WEBHOOK_URL: process.env.DRAFT_ARTICLE_N8N_WEBHOOK_URL,
    DRAFT_ARTICLE_N8N_AUTH_SECRET: process.env.DRAFT_ARTICLE_N8N_AUTH_SECRET,
  },
  emptyStringAsUndefined: true,
});
