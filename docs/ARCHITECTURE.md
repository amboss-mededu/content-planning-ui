# Architecture

Single source of truth for how this app is structured, what each layer is responsible for, and where new features slot in. Read this before adding anything bigger than a one-file change.

> Companion docs: [`AGENTS.md`](../AGENTS.md) (design-system + repo conventions), [`docs/MIGRATIONS.md`](MIGRATIONS.md) (schema-change playbook), [`docs/amboss/llms-full.txt`](amboss/llms-full.txt) (DS component reference), [`DEPLOYMENT_POCKETBASE.md`](../DEPLOYMENT_POCKETBASE.md) (runbook). For ad-hoc security review, see `/security-review` (slash command) or the GitHub Action on every PR.

> Migrated from a Convex + Vercel Workflow + Vercel Blob stack. See [`MIGRATION_PROPOSAL.md`](../MIGRATION_PROPOSAL.md) and [`DEPLOYMENT.md`](../DEPLOYMENT.md) for the retired stack's history.

---

## What this is

An internal AMBOSS staff tool for planning medical-content coverage **per specialty**. Editors trigger multi-stage AI pipelines that:

1. Extract a specialty's clinical concepts ("codes") from board-review PDFs and milestone documents.
2. Map each code against the existing AMBOSS library to identify coverage gaps.
3. Consolidate the gaps into article-level / section-level decisions (new, update, or sufficient).
4. *(Planned)* Drive a literature-search → PDF-curation → article-generation pipeline for the gaps.
5. *(Planned)* Surface progress + cost across specialties in dashboards.

Pipelines are **human-gated** at every approval boundary and **per-specialty siloed**. They are *not* crash-resumable today — see [Pipeline durability](#pipeline-durability) for the trade-off.

---

## High-level architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser (React 19, PocketBase live subscriptions, @amboss/design-system) │
│   └── /login, /planning/[specialty]/<codes|articles|sections|…>          │
└────────────┬─────────────────────────────────────────────────────────────┘
             │ pb_auth cookie  (HttpOnly, JWT signed by PocketBase)
             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Next.js 16 (long-lived `next start` Node server) — RSC + route handlers   │
│   ├── proxy.ts            sign-in gate on GET (non-GET = handler-gated)   │
│   ├── api/auth/*          Google OAuth begin/callback + dev-autologin     │
│   ├── api/uploads         PDF upload (streamed into PB file storage)      │
│   ├── api/workflows/*     pipeline triggers + approval/cancel/reset       │
│   ├── api/settings/keys   per-user provider API key writes                │
│   ├── api/sources/*       code/milestone source registries                │
│   └── lib/pb/*            cookie-authed + admin PocketBase clients        │
└──────┬──────────────────────────────────────────┬────────────────────────┘
       │ user cookie / admin auth                  │ void runAsync().catch(…)
       ▼                                           ▼
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│ PocketBase (Go binary + SQLite)  │◀───▶│ Plain async pipeline functions   │
│  • specialties / codes / …       │     │  • extractCodes Phase1/Phase2    │
│  • pipelineRuns/Stages/Events    │     │  • extractMilestones P1/P2       │
│  • ontology / amboss library     │     │  • mapCodes Phase1/Phase2        │
│  • users (OAuth) + userApiKeys   │     │  • [planned] literatureSearch    │
│  • pipelineUploads (file field)  │     │  • [planned] generateArticle     │
│  • pb_hooks/main.pb.js (allowlist│     └──────────────┬──────────────────┘
└──────────────────────────────────┘                    │
                                                         ▼
                                             ┌─────────────────────────────┐
                                             │ External LLMs / APIs         │
                                             │  • Gemini (extract, map)     │
                                             │  • Anthropic (mapping ladder)│
                                             │  • OpenAI (optional)         │
                                             │  • AMBOSS MCP (article IDs)  │
                                             └─────────────────────────────┘
```

**One backend, one auth currency.** Every PocketBase write goes through one of two clients:

- **`createServerClient(cookieHeader)`** — per-request, hydrated from the user's `pb_auth` cookie. Used by RSC pages and route handlers acting *as the signed-in user*.
- **`createAdminClient()`** — superuser session, used by background pipeline code, OAuth provisioning, dev-autologin, and seed scripts. Never reaches the browser.

PocketBase enforces row-level access via collection rules (see `pb_migrations/`). The two-client split is just convenience: admin code bypasses rules; user code is bound by them.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Next.js 16 App Router + Cache Components | RSC defaults, PPR, edge-friendly without going edge-only |
| UI components | `@amboss/design-system` (Emotion-based) | Org-mandated; forces `'use client'` wherever used |
| Backend / DB / files / live queries | PocketBase 0.37 (Go binary + SQLite) | Single self-hosted process; built-in auth, OAuth, file storage, real-time subscriptions |
| Auth | Google OAuth via PocketBase `authWithOAuth2Code` | Domain-restricted by `pb_hooks/main.pb.js`; HttpOnly `pb_auth` cookie, sync-validated by `proxy.ts` |
| Pipelines | Plain async functions, fire-and-forget from route handlers | No durable workflow runtime — see [Pipeline durability](#pipeline-durability) |
| LLMs | Vercel AI SDK v6 + Gemini / Anthropic / OpenAI (BYOK per user) | Structured output, tool use, AMBOSS MCP integration |
| File storage | PocketBase file fields | PDF uploads streamed via `/api/uploads` into `pipelineUploads.file` |
| Tests | Vitest (unit) + Playwright (e2e) | |
| Lint / format | Biome | One tool, fast |
| Env validation | `@t3-oss/env-nextjs` (Zod) | Builds fail on missing/malformed env |

---

## Module map

### PocketBase (`pb_migrations/` + `pb_hooks/`)

Schema lives in JS migration files loaded automatically by `pocketbase serve`. Each migration is forward-only; rollback is by reverse migration or by replaying from xlsx fixtures (see [`docs/MIGRATIONS.md`](MIGRATIONS.md)).

| File | Responsibility |
|---|---|
| `pb_migrations/1746540000_initial_schema.js` | Every collection, field, index, and access rule. Ports the old Convex schema. |
| `pb_migrations/1746540002_pipeline_uploads.js` | `pipelineUploads` collection (PDF file field + `uploadedBy`) |
| `pb_migrations/1778118249_updated_codes.js` | Schema patch on `codes` |
| `pb_migrations/1778118322_updated_specialties.js` | Schema patch on `specialties` |
| `pb_migrations/1778122284_harden_tenant_rules.js` | Tightened collection rules (referential + immutable invariants) |
| `pb_migrations/1778122500_ontology_rich_schema.js` | Per-specialty rich schema for icd10/hcup/abim/orpha lookups |
| `pb_hooks/main.pb.js` | OAuth email allowlist (env-overridable; defaults to AMBOSS domains) and OAuth profile mirror onto user records |

**Collections (current):** `users` (built-in, custom fields), `userApiKeys`, `specialties`, `codes`, `categories`, `articles*` (consolidated/new/update suggestions), `sections*` (consolidated section suggestions), `ontology*` (icd10/hcup/abim/orpha), `ambossLibrary` (article + section IDs), `codeSources` / `milestoneSources`, `pipelineRuns` / `pipelineStages` / `pipelineEvents`, `pipelineUploads` (PDF blobs).

### Next.js (`src/app/`)

```
src/app/
  layout.tsx                          root, providers, security headers
  page.tsx                            home grid (specialty cards)
  login/                              Google sign-in screen
  auth/callback/google/route.ts       OAuth code → session cookie exchange
  planning/
    [specialty]/
      page.tsx                        specialty overview
      layout.tsx                      tab shell
      codes/                          codes table (PB live subscription)
      articles/                       article suggestions tabs
      sections/                       section suggestions tab
      milestones/                     milestone-extraction artifacts
      categories/                     code categories
      sources/                        per-source views (ICD-10, …)
      pipeline/                       pipeline dashboard
  settings/                           per-user provider API keys
  api/
    auth/login/google/route.ts        OAuth begin (PKCE state cookie)
    auth/dev-autologin/route.ts       dev-only bypass (DEV_AUTOLOGIN_EMAIL)
    auth/logout/route.ts
    uploads/route.ts                  PDF → PocketBase file storage
    workflows/{extract,extract-milestones,map-codes,remap-code,
                approve,cancel,reset-stage,clear-stale-runs}
    settings/keys/{,status}/route.ts  provider API key CRUD + presence check
    settings/test-key/route.ts        validate a provider key
    sources/{code,milestone}/route.ts source-slug registries
    specialties/route.ts              create-specialty
    codes/[specialty]/[code]/         per-code edits + run metadata
  proxy.ts                            sign-in gate (Next 16 middleware)
```

**Future slots:** `planning/[specialty]/literature/`, `planning/[specialty]/pdfs/`, `planning/[specialty]/drafts/`, `dashboard/`.

### PocketBase clients (`src/lib/pb/`)

| File | Responsibility |
|---|---|
| `server.ts` | `createServerClient(cookieHeader)` (per-request, user-scoped) and `createAdminClient()` (superuser); also exports `PB_AUTH_COOKIE` |
| `browser.ts` | `getBrowserClient()` — singleton browser PB client (real-time subscriptions, signed-in via `pb_auth` cookie) |
| `types.ts` | TypeScript types for every collection record |
| `use-live-collection.ts` | `useLiveCollection(name, initial, opts?)` — server snapshot + client subscription. Equivalent to the old `usePreloadedQuery` / `useQuery` pair. |

**Rule:** only files in `src/lib/data/*` and `src/lib/pb/*` import `pocketbase` directly. UI never talks to PB except through the live-collection hook.

### Data layer (`src/lib/data/`)

Domain-flat. Each file owns reads + writes + admin-side helpers for a domain. RSC + route handlers import from here; pipeline code imports the `…AsAdmin` variants.

| File | Domain |
|---|---|
| `specialties.ts` | Specialty registry |
| `codes.ts` | Per-specialty clinical concepts + mapping fields |
| `categories.ts` | Code-category groupings |
| `articles.ts` | Consolidated / new / update article suggestions |
| `sections.ts` | Consolidated section suggestions |
| `code-sources.ts` / `milestone-sources.ts` | Source-slug registries |
| `pipeline.ts` | Runs / stages / events / extracted-codes staging / `pipelineUploads` |
| `code-run-metadata.ts` | Per-code run-history rollups |
| `overview.ts` | Per-specialty count rollups |
| `amboss-library.ts` | Mirror of AMBOSS article + section IDs |
| `user-api-keys.ts` | Per-user provider API keys (read by `resolve-keys` at run start) |
| `sources.ts` | Catalog of LLM ingestion source kinds |

### Pipelines (`src/lib/workflows/`)

Plain async functions — no `'use workflow'` / `'use step'` runtime. Trigger routes spawn them with `void runAsync().catch(log)`; long-lived `next start` keeps the promise alive past the HTTP response.

```
lib/
  approval.ts            deterministic per-stage token (UI ↔ approve route)
  db-writes.ts           every PB write goes through these helpers
  events.ts              logEvent + aggregateStageMetrics
  reset.ts               cascade reset across stages + clear editor data
  revalidate.ts          revalidateTag(...) — bust Next.js cache tags
  llm.ts                 unified provider wrapper (Gemini / Anthropic / OpenAI)
  parse-model.ts         provider/model spec parser
  resolve-keys.ts        merge per-user keys + env fallbacks at run start
  prompts.ts             default system prompts
  pricing.ts             token → $ for cost rollups
  amboss-mcp.ts          AMBOSS MCP tool client (mapping)
  sources.ts             content-input typing
  util.ts                chunk + small helpers
preprocessing/
  extract-codes.ts       Phase1 (LLM extract → staged codes → awaiting_approval)
                         Phase2 (promote staged → canonical codes)
  extract-milestones.ts  Phase1/Phase2 around milestone summarisation
mapping/
  map-codes.ts           Phase1 (per-code coverage analysis → awaiting_approval)
                         Phase2 (write consolidated articles + sections)
```

**Future slots:** `literature/search.ts`, `drafting/generate-article.ts`.

### Scripts (`scripts/`)

CLI tools run locally with `npm run <script>`. They authenticate to PB via `_lib/pb.ts`, which calls `createAdminClient()` after loading `.env.local`.

| Script | Purpose |
|---|---|
| `seed-pocketbase.ts` | Seed editor tables + ontology from `anesthesiology_mapping.xlsx` |
| `import-board-mapping.ts` | Import specialty registry from `board_specialty_mapping_competencies.xlsx` |
| `import-milestones.ts` | Write milestone text from a file into a specialty |
| `mark-imported.ts` | Backfill synthetic completed runs after manual import |
| `refresh-amboss-library.ts` | Re-mirror AMBOSS article + section IDs |
| `wipe-prod.ts` | One-shot wipe of every PB collection (dev only) |
| `start-extract.ts` | Trigger an extract run from the CLI (smoke test) |
| `configure-oauth.ts` | Push `GOOGLE_OAUTH_CLIENT_ID/SECRET` onto a PB instance |

### Shared `src/lib/`

| Path | Responsibility |
|---|---|
| `auth/index.ts` | `getCurrentUser`, `isAuthenticated`, `requireUserResponse` (route-handler guard) |
| `phase.ts` | Runtime → display-phase mapping for the home grid |

---

## Auth model

Two callers, one PocketBase backend.

```
┌─ Browser / RSC / route handler ────┐    ┌─ Pipeline / scripts / OAuth setup ┐
│ user signs in via Google OAuth     │    │ has POCKETBASE_ADMIN_EMAIL/PASSWD │
│ pb_auth HttpOnly cookie set by     │    │ authWithPassword on _superusers   │
│ /auth/callback/google              │    │                                   │
└──────────────┬─────────────────────┘    └────────────────┬──────────────────┘
               │                                            │
               ▼                                            ▼
        ┌──────────────────────────────────────────────────────────┐
        │ PocketBase collection rule check                         │
        │   (built-in; rules declared in pb_migrations/*.js)       │
        │     • cookie carries valid user JWT → user-scoped allow  │
        │     • admin client → bypasses rules                      │
        │     • else → 403/404                                     │
        └──────────────────────────────────────────────────────────┘
```

**Sign-in path.** `LoginPage` links to `/api/auth/login/google?next=…`. That route asks PB for fresh OAuth state + PKCE verifier, stashes `{state, codeVerifier, next, redirectUri}` in a 5-minute HttpOnly cookie, and redirects to Google. The callback at `/auth/callback/google` validates state, exchanges the code via `authWithOAuth2Code`, and writes the long-lived `pb_auth` cookie. Domain restriction is enforced **in PocketBase** by `pb_hooks/main.pb.js` so it can't be bypassed by a Next.js bug.

**Dev-only bypass.** When `NODE_ENV=development` and `DEV_AUTOLOGIN_EMAIL` is set, the proxy redirects unauthenticated users to `/api/auth/dev-autologin`, which mints a 7-day session via the admin client. The route returns 404 in production.

**Sync validation in the proxy.** `proxy.ts` (Next 16 middleware) loads the `pb_auth` cookie into a `PocketBase` instance and reads `authStore.isValid` — a synchronous JWT exp check, no network call. Token rotation/refresh happens lazily on the next API call.

**Required environment variables:**

| Variable | Purpose |
|---|---|
| `POCKETBASE_URL` | Base URL of the PB instance (e.g. `http://localhost:8090`) |
| `NEXT_PUBLIC_POCKETBASE_URL` | Same, exposed to the browser for live subscriptions |
| `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` | Superuser credentials (admin client + scripts) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Configured into PB via `configure-oauth` script |
| `STAFF_EMAIL_ALLOWLIST` *(set on the PB process)* | Comma-separated allowlist; falls back to AMBOSS-domain whitelist |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Optional env fallback for Gemini |
| `ANTHROPIC_API_KEY` | Optional env fallback for Anthropic |
| `OPENAI_API_KEY` | Optional env fallback for OpenAI |
| `AMBOSS_MCP_URL` / `AMBOSS_MCP_TOKEN` | AMBOSS MCP tool endpoint |
| `DEV_AUTOLOGIN_EMAIL` | Dev-only auto-login |
| `GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` / `MAPPING_SHEET_IDS` | Optional service account for spreadsheet imports |

**Provider keys.** Every signed-in user can save their own Gemini / Anthropic / OpenAI keys via `/settings`. The pipeline picks per-user keys first and falls back to env-level keys (`resolveApiKeysForRun` in `src/lib/workflows/lib/resolve-keys.ts`).

---

## Request flow (interactive read)

```
Browser
  │
  │ 1. GET /planning/anesthesiology/codes
  ▼
proxy.ts (Next 16 middleware)
  │   • method !== GET  → fall through (handler-gated)
  │   • cookie missing  → redirect /login?next=… (or /api/auth/dev-autologin)
  │   • cookie invalid  → redirect /login
  │   • cookie valid    → continue
  ▼
Next.js RSC page (planning/[specialty]/codes/page.tsx)
  │
  │ 2. await Promise.all([
  │      getConsolidationLockState(slug),
  │      listCodes(slug),                ← createServerClient(cookies)
  │      listInFlightMappings(slug),
  │    ])
  ▼
PocketBase (over HTTP, cookie-authed)
  │   • collection rules vet the cookie
  │   • return rows
  ▼
Hydrated client component (CodesViewClient)
  │   • initial: server-rendered rows
  │   • useLiveCollection('codes', initial, { filter })
  │     opens a PB WebSocket subscription, applies create/update/delete
  ▼
Browser receives initial HTML + PB realtime pushes for updates
```

---

## Pipeline flow (write + approval)

```
User clicks "Start extract" in pipeline-dashboard
  │
  ▼
POST /api/workflows/extract  (Next route handler)
  │   • requireUserResponse() — 401 if not signed in
  │   • validate body, resolve specialty via createServerClient
  │   • createPipelineRun + initPipelineStage('extract_codes')
  │   • resolveApiKeysForRun(user) — merge user keys + env fallbacks
  │   • void extractCodesPhase1(...).catch(logErr)   — fire-and-forget
  │   • respond 200 { runId, approvalToken }         — UI starts polling/subscribing
  ▼
Background promise (still in the same Node process)
  │
  ├── markStageRunning('extract_codes')
  ├── identifyModulesForUrl(...)        ← Gemini, per PDF URL, capped concurrency
  ├── extractCodesForCategory(...)      ← Gemini, per (URL, module)
  ├── writeExtractedCodes(rows)         ← PB insert (staging)
  └── markStageAwaitingApproval(...)
                       │
                       ▼ user clicks "Approve" in UI
  ┌────────────────────────────────────────────┐
  │ POST /api/workflows/approve                │
  │   • getCurrentUser() — server-stamped      │
  │   • approvedBy = user.email                │
  │   • dispatch by stage:                     │
  │       extract_codes → extractCodesPhase2() │
  │       extract_milestones → …Phase2()       │
  │       map_codes → mapCodesPhase2()         │
  └────────────────────────────────────────────┘
                       │
                       ▼  (Phase 2, fire-and-forget again)
  ├── promoteExtractedCodesToCodes(...)
  ├── revalidateSpecialtyCache(...)     ← revalidateTag (in-process)
  └── markStageCompleted(approvedBy)
```

The **two-phase split** replaces the old `createHook` / `resumeHook` pattern. `Phase1` runs to `awaiting_approval` and exits cleanly; `Phase2` is invoked from `/api/workflows/approve`. No persistent workflow state means a process restart between Phase 1 and approval is fine — the staged data is on `pipelineStages.draftPayload` in PB, and Phase 2 reads it back. A process restart **during** Phase 1 or Phase 2 loses the in-flight run; the stage stays `running` until cleaned up by `clear-stale-runs`.

The **deterministic approval token** (`approve:<runId>:<stage>`) is now an opaque per-stage identifier the UI echoes back. The approve route looks at runId + stage directly to invoke the matching `*Phase2`.

---

## Pipeline lifecycle

Each `pipelineRuns` row owns a chain of `pipelineStages`. Status transitions:

```
pipelineRuns:
  running ─┬─→ awaiting_preprocessing_approval ─→ mapping ─→ consolidating ─→ completed
           ├─→ failed
           └─→ cancelled

pipelineStages (per stage in a run):
  pending ─→ running ─┬─→ awaiting_approval ─┬─→ approved ─→ completed
                      │                       └─→ (rejected) ─→ skipped
                      ├─→ failed
                      └─→ skipped
```

**Resetting a stage** (`/api/workflows/reset-stage`) cascades to every downstream stage and clears editor data tied to it. Run status flips to `cancelled` so the dashboard stops treating it as active.

**Stale runs.** Without a durable runtime, a deploy or crash can orphan a `running` stage. `/api/workflows/clear-stale-runs` flips runs older than a threshold to `cancelled`. There's no guarantee of partial-result cleanup; rerun the stage to overwrite.

---

## Pipeline durability

The previous architecture used the Vercel Workflow runtime, which gave us crash-resumable, step-cached, replay-capable pipelines. We dropped it to remove a runtime dependency and simplify the deploy story (single Node process + PB binary).

**What we lose:** if the process crashes mid-stage, the in-flight run is gone. Stages stay `running` until manually reset.

**What we keep:** approval gates (split into `Phase1`/`Phase2`), event log, cost rollups, idempotent staged writes, deterministic approval tokens.

**When this matters.** Today's runs are minutes-long and triggered manually by editors who can re-run on failure. If we add long-running ingestion or unattended scheduling, revisit by either:
- Reintroducing a workflow runtime (Vercel Workflow / Inngest / Trigger.dev), **or**
- Persisting per-step checkpoints to `pipelineEvents` and writing a resume helper.

---

## Conventions

### Naming + file layout

- PB collection rules + indexes live in `pb_migrations/<ts>_<name>.js`. New collections: add a migration; never edit a previous one.
- Next.js routes follow App Router. Page-local components go in `_components/` siblings (`_components/` is excluded from routing). Client components end with `.tsx` and start with `'use client'`.
- Pipeline code lives under `src/lib/workflows/<phase>/<feature>.ts`. Approval-gated stages split into `*Phase1` / `*Phase2`.

### Server vs. client

- **Default to server components.** Mark client only when needed (`useState`, browser APIs, PB realtime subscriptions, design-system components).
- Pages that subscribe to live data render an initial snapshot in the RSC and pass it to a `useLiveCollection`-driven client component. The hook seeds state from the snapshot once; from then on, the PB WebSocket owns updates. **Do not** resync state from a fresh `initial` reference in `useEffect` — it loops.
- Heavy interactive widgets (codes table, pipeline dashboard) live in `_components/`, marked client; their data hydration comes from RSC parents.

### Auth boundary checklist

When you add a new Next.js API route:

1. **Mutating route** (POST/PATCH/DELETE) → `requireUserResponse()` at the top, returns 401 if missing.
2. **Read route** → relies on `proxy.ts` GET-redirect; no in-handler check needed (but doesn't hurt).
3. **Service route** (machine-to-machine, no signed-in user) → require a shared secret in a header and fail-closed in production. None today; the previous `internal/revalidate` indirection was collapsed into in-process `revalidateTag` calls.

When you add a new PB collection:

1. **User-scoped** → declare `listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule` in the migration. Pattern: `@request.auth.id != "" && <ownership check>`.
2. **Admin-only** → leave rules `null`; only `createAdminClient()` callers can read/write.
3. **Read-only ontology** → `listRule = viewRule = "@request.auth.id != \"\""`; create/update/delete `null`.

### Storage choices

| Kind | Storage |
|---|---|
| Structured data + relations | PocketBase (SQLite) |
| Pipeline event log | PocketBase (`pipelineEvents`) |
| Binary artefacts (PDFs) | PocketBase file fields (`pipelineUploads.file`) |
| Ephemeral cache state | Next.js `unstable_cache` / `revalidateTag` |
| Secrets | Process env (`.env.local` → `src/env.ts`) for Next; PB env for hooks |

### LLM-output normalization

LLM responses sometimes use natural-language strings as object keys (e.g. `{ "Vitamin B₁₂ deficiency": [...] }`). PocketBase `json` fields *can* store these directly, but they're awful to query and validate. We always transform at the pipeline boundary:

```diff
- { "Vitamin B₁₂": ["sec_a"], "Megaloblastic anaemia": ["sec_b"] }
+ [{ articleTitle: "Vitamin B₁₂", sections: ["sec_a"] },
+  { articleTitle: "Megaloblastic anaemia", sections: ["sec_b"] }]
```

App-side validation enforces the array shape — no string-blob columns for new fields.

---

## Future modules

Placeholders. Each gets its own architecture-doc section once the feature spec is firm — for now, just know where they slot in.

### `literature` collections + `src/lib/workflows/literature/search.ts`

```
[approved article/section]
  └─ POST /api/workflows/literature-search
       └─ runs literatureSearch (plain async, fire-and-forget)
            ├─ webSearch(...)              -- TBD provider
            ├─ filterByLicense(...)
            └─ writes literatureCandidates rows (per article/section)
```

Tables: `literatureSearches` (one per article/section, status), `literatureCandidates` (many per search; title, authors, abstract, source URL, license-flag).

### `pdfDocuments` collection + PB file storage

```
[user picks candidate]
  └─ drag-drop PDF (or paste URL) → /api/uploads (already exists)
       └─ pdfDocuments insert
            ├─ file (PB file field), sha256
            ├─ metadata: title, authors, journal, year, doi, pubmedId, license, …
            └─ status: pending | reviewed | approved | rejected
```

The metadata schema is shaped by the CMS workflow — to be filled in when that's specced.

### `src/lib/workflows/drafting/generate-article.ts` + `articleDrafts` collection

```
[approved PDFs for an article topic]
  └─ POST /api/workflows/generate-article
       └─ runs generateArticle Phase1 / Phase2
            ├─ summarisePdfs(...)
            ├─ assembleAmbossArticle(...)
            ├─ writes articleDrafts row (status=awaiting_approval)
            └─ Phase2 invoked from /api/workflows/approve-draft
```

The **review loop is the same Phase1/Phase2 shape** as today's stages — pause at `awaiting_approval`, dashboard surfaces the draft, human approves/rejects via `/api/workflows/approve-draft`, Phase 2 fires.

### `dashboard` collection(s) + `src/app/dashboard/`

Aggregation queries reading from `pipelineRuns`, `pipelineEvents`, `codes`, `articles*`, `pdfDocuments`, `articleDrafts`. KPIs surface as live charts using `useLiveCollection`.

KPIs (starter): codes-mapped %, articles consolidated, sections consolidated, PDFs ingested, articles generated, articles published, pipeline cost (USD), throughput by stage. Refined when dashboards are built.

---

## Where to make changes

| Task | Touch |
|---|---|
| New PB collection + UI tab | `pb_migrations/<ts>_<name>.js` + `src/lib/pb/types.ts` + `src/lib/data/<domain>.ts` + `src/app/planning/[specialty]/<feature>/` |
| New pipeline stage | `src/lib/workflows/<phase>/<stage>.ts` (split `Phase1` / `Phase2` if approval-gated) + new `pipelineStages.stage` value + UI dashboard card + add dispatch case in `/api/workflows/approve` |
| New API route | `src/app/api/<…>/route.ts` + auth guard from [Auth boundary checklist](#auth-boundary-checklist) |
| New script | `scripts/<name>.ts` using `createAdminClient` from `scripts/_lib/pb.ts` + `package.json` script entry |
| New env var | `src/env.ts` (Next-side) **and** document here. PB-process env vars (`STAFF_EMAIL_ALLOWLIST`, OAuth credentials) go in `DEPLOYMENT_POCKETBASE.md`. |

---

## Glossary

- **Specialty** — a medical discipline (anesthesiology, dermatology, …) being planned. Most data is keyed by `specialtySlug`.
- **Code** — a clinical concept extracted from board-review or milestone documents (e.g. `ab_anes_0001`). Maps to AMBOSS articles + sections.
- **Mapping** — the LLM-driven decision per code about whether AMBOSS already covers it, and what gaps remain.
- **Consolidation** — merging per-code mapping output into per-article and per-section editorial decisions.
- **Stage** — one step of a pipeline run (`extract_codes`, `extract_milestones`, `map_codes`, `consolidate_*`).
- **Approval token** — opaque per-stage identifier (`approve:<runId>:<stage>`) the UI echoes back to `/api/workflows/approve` to trigger the matching Phase 2.
- **Run** — one execution of the pipeline for a specialty. Owns N stages and writes to `pipelineEvents`.
- **Phase 1 / Phase 2** — the split of an approval-gated stage. Phase 1 produces a draft and parks the stage at `awaiting_approval`; Phase 2 promotes/persists it after the human approves.
