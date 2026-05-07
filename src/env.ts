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
    INTERNAL_REVALIDATE_SECRET: optionalString,
    POCKETBASE_URL: optionalString,
    POCKETBASE_ADMIN_EMAIL: optionalString,
    POCKETBASE_ADMIN_PASSWORD: optionalString,
    GOOGLE_OAUTH_CLIENT_ID: optionalString,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
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
    INTERNAL_REVALIDATE_SECRET: process.env.INTERNAL_REVALIDATE_SECRET,
    POCKETBASE_URL: process.env.POCKETBASE_URL,
    POCKETBASE_ADMIN_EMAIL: process.env.POCKETBASE_ADMIN_EMAIL,
    POCKETBASE_ADMIN_PASSWORD: process.env.POCKETBASE_ADMIN_PASSWORD,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    NEXT_PUBLIC_POCKETBASE_URL: process.env.NEXT_PUBLIC_POCKETBASE_URL,
  },
  emptyStringAsUndefined: true,
});
