# DEPLOYMENT.md — Convex / Vercel snapshot (HISTORICAL)

> **Status: HISTORICAL.** This documents the architecture *as it existed*
> before the Convex → PocketBase migration. The Convex deployment has
> been wiped and the Vercel project is being decommissioned. Kept in the
> repo so the wiring isn't lost; for the active runbook see
> [`DEPLOYMENT_POCKETBASE.md`](./DEPLOYMENT_POCKETBASE.md). Architecture
> rationale lives in [`MIGRATION_PROPOSAL.md`](./MIGRATION_PROPOSAL.md).

## Stack overview

- **Next.js 16** (App Router, React 19, `cacheComponents: true`,
  `'use workflow'`-aware) running on Vercel.
- **Convex** as the reactive data layer (`convex/` directory; ~16
  tables across 11 domain modules).
- **Convex Auth** (`@convex-dev/auth` Password provider with email +
  OTP via Resend) restricted to `@amboss.com` / `@medicuja.com` /
  `@miamed.de` (or an explicit `STAFF_EMAIL_ALLOWLIST`).
- **Vercel Workflow DevKit** (`withWorkflow()` wrap in `next.config.ts`)
  for the multi-stage extraction pipeline. Cross-deployment handshake
  via `WORKFLOW_SECRET`.
- **Vercel Blob** for PDF source uploads
  (`BLOB_READ_WRITE_TOKEN` auto-provisioned by the Blob integration).
- **AMBOSS MCP** (external) for content lookups
  (`AMBOSS_MCP_URL` + `AMBOSS_MCP_TOKEN`).
- **AI providers** (Google Generative AI / Anthropic / OpenAI) — keys
  per-user (Convex `userApiKeys` table) with optional env fallbacks.

## Prerequisites

- **Node** 24 (`.node-version`)
- **npm** 11.9.0 (`packageManager` in `package.json`); `.npmrc` enables
  `legacy-peer-deps=true`
- **Vercel CLI** logged in (`vercel login`)
- **Convex CLI** via `npx convex` (no global install)
- **GitHub repo** linked to Vercel (preview deploys per branch)

## Step 1 — Convex deployment first

Convex must exist before Vercel because the Vercel build needs
`CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` baked into the build.

```bash
npx convex dev          # creates dev deployment, writes both vars to .env.local
npx convex deploy --prod   # creates prod deployment when ready
```

Then push the auth + workflow secrets onto the Convex deployment
(separate from Vercel env vars):

```bash
# 1. Generate JWT keypair for Convex Auth
node scripts/generate-auth-keys.mjs > /tmp/keys.env
set -a; source /tmp/keys.env; set +a

# 2. Push to Convex (repeat with --prod / --preview-name <name> per env)
npx convex env set -- JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY"
npx convex env set -- JWKS "$JWKS"
npx convex env set SITE_URL http://localhost:3000   # update after Vercel deploys

# 3. Workflow service token (must match Vercel — see Step 4)
npx convex env set WORKFLOW_SECRET "$(openssl rand -hex 32)"

# 4. Optional: explicit staff allowlist (otherwise falls back to domain check)
npx convex env set STAFF_EMAIL_ALLOWLIST "alice@amboss.com,bob@medicuja.com"

# 5. Discard temp keys
rm /tmp/keys.env
```

## Step 2 — Create + link Vercel project

```bash
vercel link              # framework auto-detects Next.js; no vercel.json needed
```

The repo has no `vercel.json` / `vercel.ts` — zero-config deploy.

## Step 3 — Vercel Marketplace integrations

- **Vercel Blob** (required) — provisions `BLOB_READ_WRITE_TOKEN`
  automatically. Used by `src/app/planning/[specialty]/pipeline/_components/input-row.tsx`
  + `src/app/api/blob/upload-token/route.ts` for PDF uploads.
- **Neon Postgres** (optional, never went live) — referenced in
  `.env.example` but the active data layer is Convex.

After enabling integrations:

```bash
vercel env pull .env.local   # pulls integration-provided vars
```

## Step 4 — Vercel environment variables

All vars are validated by `src/env.ts` (`@t3-oss/env-nextjs`); the
build fails fast if a required one is missing.

| Var | Scope | Required | Notes |
|---|---|---|---|
| `CONVEX_DEPLOYMENT` | server | yes | Set by `convex dev`/`deploy`. Identifies the dev/prod project. |
| `NEXT_PUBLIC_CONVEX_URL` | client | yes | Convex WebSocket endpoint. |
| `WORKFLOW_SECRET` | server | yes (prod) | **Must match the Convex env var of the same name.** Bearer token used by workflow code + scripts to call public Convex functions outside a request context. |
| `INTERNAL_REVALIDATE_SECRET` | server | yes (prod) | Guards `/api/internal/revalidate`; only the workflow sandbox knows it. `openssl rand -hex 32`. |
| `BLOB_READ_WRITE_TOKEN` | server | yes | Auto-set by Blob integration. |
| `AMBOSS_MCP_URL` | server | optional | Mapping agent's tool backend. |
| `AMBOSS_MCP_TOKEN` | server | optional | Bearer token for above. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | server | optional fallback | Per-user keys preferred (stored in Convex `userApiKeys`). |
| `ANTHROPIC_API_KEY` | server | optional fallback | Mapping agent's final retry (Opus). |
| `OPENAI_API_KEY` | server | optional fallback | Per-user fallback. |
| `GOOGLE_SA_CLIENT_EMAIL` | server | optional | Google Sheets service account (live mapping reads). |
| `GOOGLE_SA_PRIVATE_KEY` | server | optional | Same; src/env.ts unescapes `\n`. |
| `MAPPING_SHEET_IDS` | server | optional | JSON `{slug: sheetId}` map. |
| `LOCAL_XLSX_FIXTURES` | server | optional (dev) | `slug:path,slug:path`. |
| `NODE_ENV` | server | auto | Set by Vercel. |

Auto-set by Vercel: `VERCEL_URL`, `NODE_ENV`.

Auth secrets (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`,
`STAFF_EMAIL_ALLOWLIST`) live on the **Convex** deployment, not in
Vercel env. See Step 1.

## Step 5 — Deploy

```bash
vercel deploy --prod
```

Then update Convex's `SITE_URL` to the resulting URL so OAuth callbacks
land on the right host:

```bash
npx convex env set SITE_URL https://content-planning-ui.vercel.app
```

(Repeat for preview deployments with the appropriate `--preview-name`.)

## Step 6 — Verification

1. Hit the deployed URL → `src/proxy.ts` redirects unauthenticated
   visitors to `/login`.
2. Sign in with an allowlisted email → confirm OTP via email →
   redirect to `/`.
3. Pick a specialty → trigger an extraction → observe stage
   progression in the UI (Convex `useQuery` reactive updates).
4. Approve a stage; confirm downstream stage starts.
5. Upload a PDF source; confirm it lands in Vercel Blob and is
   referenced in the new pipeline run.

## Step 7 — (Re)seeding

All seed scripts use `dotenv -e .env.local --` and require
`CONVEX_DEPLOYMENT` + `WORKFLOW_SECRET` in `.env.local`.

```bash
npm run seed:convex             # seeds from xlsx fixtures into Convex
npm run seed:ontology           # ICD-10 / HCUP / ABIM / Orpha lookups
npm run import-board            # board specialty mapping competencies
npm run import-milestones       # milestone competency text
npm run mark-imported           # flags rows post-import
npm run refresh-amboss-library  # mirrors AMBOSS library snapshot
npm run wf:extract              # triggers an extraction run from CLI
```

## Architecture-defining files

- `src/env.ts` — env validation (single source of truth for env vars).
- `next.config.ts` — `withWorkflow()` wrap, `cacheComponents: true`,
  five security headers (X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Permissions-Policy, HSTS).
- `src/proxy.ts` — auth gate (`convexAuthNextjsMiddleware`); matches
  all paths except static assets.
- `convex/schema.ts` + `convex/schema/*.ts` — 11 domain modules
  aggregating into ~16 tables.
- `convex/auth.ts` — domain allowlist + Resend OTP wiring.
- `convex/auth.config.ts` — JWT issuer (`CONVEX_SITE_URL`).
- `src/lib/convex/server.ts` — `fetchQueryAsUser` /
  `fetchMutationAsUser` / `preloadQueryAsUser` wrappers that auto-attach
  the auth token.
- `src/lib/auth/index.ts` — `getCurrentUser`, `isAuthenticated`,
  `requireUserResponse` API helpers.
- `src/lib/workflows/` — pipeline implementations
  (`'use workflow'`-marked files).

## What was NOT needed

- No `vercel.json` / `vercel.ts` — zero-config Next.js detection.
- No cron jobs.
- No custom regions / function timeouts / image domains.
- Vercel Analytics + Speed Insights are rendered from
  `src/app/layout.tsx` (inert off-platform, active when deployed to
  Vercel).

## Project IDs (for reference; Vercel project being deleted)

- Vercel project: `prj_0RDds5yqe0iDAxXSqR1ZcgcME91u` (`content-planning-ui`)
- Vercel org: `team_h42NILHTFlJpAKDyC0T3eBHk`
- Convex deployment: see `CONVEX_DEPLOYMENT` value in the (now-archived)
  `.env.local`.

---

For the replacement architecture (PocketBase + Google OAuth),
see [`DEPLOYMENT_POCKETBASE.md`](./DEPLOYMENT_POCKETBASE.md).
