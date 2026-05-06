# Migration Proposal — Post-Convex / Post-Vercel Architecture

> **Status: PROPOSAL FOR REVIEW.** No code has been migrated. This document
> exists so reviewers can sign off on the target architecture before the actual
> deploy docs (`DEPLOYMENT.md` + `DEPLOYMENT_POCKETBASE.md`) and the migration
> work itself are produced.

## TL;DR

- **Decommissioning** the Vercel project and the Convex backend.
- **Replacing Convex with PocketBase** — an open-source self-hosted backend
  (single Go binary + single SQLite file) that gives Convex-style real-time
  updates without any vendor relationship.
- **Replacing Convex Auth with Auth.js + Google OAuth**, domain-restricted to
  `@amboss.com` / `@medicuja.com` / `@miamed.de` (uses the existing Workspace
  subscription, no new SaaS to approve).
- **Sharing the database across the team** via committed xlsx seed fixtures +
  a `seed:local` script — not by committing the SQLite file itself.
- **Deployment options**: Kubernetes (`Deployment` + `PVC`), AWS EC2, internal
  VPS — anywhere that can host one stateful pod / VM. **Cannot run on Vercel**
  (ephemeral filesystem); must be a separate stateful host.

---

## Why we're moving

- **Privacy / data residency.** Convex is a SaaS — content data sits on a
  third party's infrastructure, requires a contract / DPA, and triggers
  institutional procurement approval that we don't currently have.
- **Vendor independence.** We want the option to operate without depending
  on any specific managed-DB provider.
- **Cost predictability.** Self-hosted on infra we already pay for vs. a
  per-usage SaaS bill.

---

## Why PocketBase

PocketBase ([pocketbase.io](https://pocketbase.io)) is an open-source backend
distributed as a single ~25 MB Go binary. It bundles:

- **SQLite** for storage (one file on disk)
- **REST API + JS SDK** auto-generated from collection definitions
- **Real-time WebSocket subscriptions** — `pb.collection().subscribe()`
- **Authentication** (email/password, OAuth, OTP) with a built-in users table
- **File uploads** (per-collection file fields, served via signed URLs)
- **Admin web UI** for inspecting/editing data
- **Schema migrations** (`pb_migrations/*.js` auto-generated)
- **`pocketbase backup`** built-in command

License: **MIT**. ~58k GitHub stars. Releases roughly every 5 days.

### Why not the alternatives

| Option | Why ruled out |
|---|---|
| **Convex / Firestore / Supabase / Firebase** | All SaaS — same contract / DPA / approval problem we're trying to leave behind. |
| **BigQuery** | Wrong shape entirely. OLAP data warehouse: 1-5 second query latency, no native real-time, append-optimized writes (UPDATE/DELETE quotas), per-query pricing. Would break the editor UX. *Useful as a downstream analytics sink — see below.* |
| **Plain SQLite by itself** | Storage only. We'd hand-build the API layer (~hundreds of LoC), real-time push (~200+ LoC for SSE/WebSocket), auth (login/sessions/OAuth), file handling, admin UI, migrations, backup tooling. Estimated 1,000-2,000 LoC of glue we'd own forever. PocketBase gives us all of that for free, around the same SQLite file. |
| **Triplit** | Strong TypeScript-native CRDT alternative, but smaller community (~3k stars), fewer production references, more complex mental model. PocketBase is the safer bet for "boring works." |
| **ElectricSQL** | Requires a Postgres backend — adds operational complexity, doesn't simplify the privacy story. |
| **PocketBase** ✓ | Closest Convex DX (real-time, multi-table, admin UI), single file, no vendor. |

### What we get vs. what we give up

**Get**: Convex-style reactive UX preserved, ~50 LoC of SDK setup vs.
1,000-2,000 LoC of DIY plumbing, free admin UI for non-engineers,
zero vendor relationship.

**Give up**: serverless auto-scaling (PocketBase is single-instance — fine
for an internal team-scale tool), Convex's Functions-as-a-Service ergonomics
(workflow code becomes plain async functions calling the SDK directly).

---

## Why this is safe (the brief for Content Platform)

> Plain-language summary you can paste into Slack / email / a meeting agenda.

**What is PocketBase?** An open-source backend distributed as a single Go
binary. Bundles SQLite storage, REST API, real-time WebSocket subscriptions,
auth, file uploads, and an admin UI. Think "everything Convex / Firebase
gives you, but as a self-hosted binary."

**Why no procurement / no contract is needed:**

- MIT license — free for commercial use, no fee, no signup, no account.
- It is **not a SaaS**. There is no PocketBase company we'd sign anything
  with. It's an open-source project (maintained by Gani Georgiev), legally
  the same category as nginx, Postgres, or Redis.
- **No data ever leaves our infrastructure.** PocketBase has no cloud, no
  telemetry, no phone-home. The only outbound network calls are ones we
  explicitly configure (e.g., Google OAuth → Google).
- No new vendor relationship, no DPA needed, no third-party data processor
  exists.

**Where the data lives:**

- Local dev → developer's laptop (`./pb_data/data.db`)
- Production → our EBS volume / Kubernetes PersistentVolume / VPS disk

**Operationally:** equivalent to running one Postgres pod, but smaller
(256Mi memory, 200m CPU baseline). Same backup story (snapshot the disk +
nightly export to S3/GCS). Same monitoring story (HTTP healthcheck on
`/api/health`).

**Headline:** *"Open-source software we run on our own infrastructure. Same
vendor relationship as nginx — none. All data stays on hardware Content
Platform controls."*

---

## Will the schema fit? (Yes.)

We currently have ~16 Convex tables across 11 domain modules. Each maps
cleanly to a PocketBase collection:

| Current Convex pattern | PocketBase equivalent | Notes |
|---|---|---|
| ~16 tables | ~16 collections | PocketBase handles 50+ comfortably. |
| Multiple indexes per table (`by_specialty`, `by_specialty_code`, `by_run_stage_created`) | Custom indexes per collection | Single + composite, declared in admin UI; SQLite `CREATE INDEX` under the hood. |
| `v.id('users')` references | `relation` field type | First-class FK with cascade-delete options. |
| `jsonBlobString` (heterogeneous payloads in `pipelineStages.outputSummary`, `pipelineEvents.metrics`, `extractedCodes.metadata`) | `json` field type | 1:1 mapping, zero friction. |
| `v.array(coveredSectionShape)` typed nested object arrays | `json` field type (recommended) OR normalize to a separate collection | Recommend inline JSON for first cut — matches existing pattern; validation stays at the TypeScript layer where it already is. Normalize only if we want to query INTO the nested data. |
| Convex Auth tables (`authTables`) | Goes away — replaced by Auth.js + PocketBase's built-in users collection | Net schema simplification. |
| Volatile `mappingsInFlight` (high churn insert/delete) | Same — PocketBase + SQLite WAL handles this fine | No issue. |
| Real-time `useQuery` subscriptions | `pb.collection().subscribe('*', cb)` | Per-collection channels, same per-row reactive shape. |

**Decisions to make** (not blockers, just choices):

1. **Nested arrays inline vs. normalized.** Recommendation: inline JSON for
   first cut. Matches what we already do.
2. **Schema-as-code approach.** Recommendation: write a one-shot bootstrap
   script that creates the collections programmatically via the JS SDK to
   match the current Convex schema. After that, use the admin UI for
   ongoing changes — PocketBase auto-generates migration files in
   `pb_migrations/` which get committed to git.

**What disappears (in a good way):** `WORKFLOW_SECRET` cross-deploy juggling,
the Convex Auth wiring, JWT key generation. Net complexity goes *down*.

---

## Deployment options

### Local development (every dev's machine)

```bash
git clone <repo>
cd amboss-content-planner-ui
npm ci
./bin/pocketbase serve --dir=./pb_data &     # :8090
npm run seed:local                           # rebuilds DB from xlsx fixtures
npm run dev                                  # :3000
```

- `pb_data/` is gitignored.
- Admin UI: `http://localhost:8090/_/`
- DB regenerates from the committed xlsx fixtures (same pattern as
  today's `seed:convex`).

### Production — pick one

Three viable patterns, all running on infra we already have or can spin up:

**A. Kubernetes (preferred if Content Platform runs k8s)**

- One-replica `Deployment` (PocketBase is single-instance — SQLite is
  single-writer, fine for our scale).
- `PersistentVolumeClaim` ~10-20 Gi mounted at `/pb_data`.
- `Service` (ClusterIP) on port 8090.
- `Ingress` with TLS via cert-manager + Let's Encrypt → `pb.<our-domain>`.
- `CronJob` nightly: `pocketbase backup` + upload snapshot to S3 / GCS.
- Resource ask: 256Mi memory, 200m CPU baseline.
- Operationally similar to one Postgres pod, smaller footprint.

**B. AWS EC2**

- One `t4g.small` (ARM, ~$13/mo) with EBS volume for `/pb_data`.
- Run as `systemd` service.
- ALB or direct DNS + Caddy/nginx for TLS.
- AWS Backup snapshots EBS nightly, OR PocketBase backups → S3.
- Total cost: ~$10-20/mo.

**C. Hetzner / internal VPS** (privacy maximalist option)

- €5-20/mo VM (Hetzner EU-Central — Frankfurt — for data residency).
- Same systemd + Caddy pattern as AWS option.
- Backups → Hetzner Storage Box.

### Why NOT Vercel for PocketBase

PocketBase **cannot run on Vercel.** Vercel runs serverless Functions on
ephemeral compute — the filesystem doesn't persist between requests, instances
spin up/down on demand, and we'd need N parallel instances each with their
own (incoherent) state. PocketBase needs:

- **One** long-running process so WebSocket subscriptions stay coherent
- A **persistent disk** for the SQLite file
- A **stable port** for WebSocket upgrades

Vercel gives us none of those. The Next.js frontend can absolutely stay on
Vercel (we just point `POCKETBASE_URL` at the remote PocketBase URL); PocketBase
itself goes to one of the stateful hosts above.

### Where Next.js runs (independent decision)

Two options for the Next.js side, independent of where PocketBase runs:

| Option | Pros | Cons |
|---|---|---|
| **Stay on Vercel** + remote PocketBase | Keep current Vercel DX (preview URLs, instant deploys, Analytics, Speed Insights) | Frontend is on Vercel infrastructure (frontend itself doesn't store data, but it does proxy auth + API calls) |
| **Co-locate Next.js + PocketBase** on the same VPS / k8s | Fully self-hosted, single deploy target | Lose Vercel ergonomics, more ops work |

Recommended: stay on Vercel for Next.js (only proxies requests; no data lives
there) + remote PocketBase on our infra. Easiest and keeps current developer
experience. Switch to fully self-hosted later if Vercel itself becomes a
concern.

---

## Auth — Google OAuth via Auth.js

Replaces Convex Auth with Workspace identity.

- **Library**: Auth.js (NextAuth) v5 — `next-auth@beta @auth/core`.
- **Provider**: Google OAuth — uses our existing Workspace subscription, no
  new SaaS dependency.
- **Restriction**: domain-allowlist `@amboss.com` / `@medicuja.com` /
  `@miamed.de` checked in the Auth.js `signIn` callback (replaces the
  `STAFF_EMAIL_ALLOWLIST` Convex env var).
- **Session**: Auth.js issues a session cookie. `src/proxy.ts` checks
  `auth()` instead of Convex Auth.
- **PocketBase user record**: on first sign-in, upsert a row in PocketBase's
  built-in users collection keyed by Google sub. App code uses this for
  stable user IDs (per-user API keys, audit trail).
- **No more JWT keypair generation** (`scripts/generate-auth-keys.mjs` becomes
  obsolete).

Required env vars (replaces all Convex auth env vars):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` (`openssl rand -hex 32`).

---

## Data sharing across the team

The actual goal — "anyone can clone the repo and run the app, no external
provider" — is solved by committing the **recipe**, not the database.

- ❌ **Don't** commit `pb_data/data.db`. SQLite's own docs and community
  consensus call this out as an anti-pattern: binary diffs bloat history,
  concurrent edits cause unresolvable merge conflicts, no useful diff/merge
  tooling exists. ([sqlite.org/whynotgit.html](https://sqlite.org/whynotgit.html))
- ✅ **Do** commit:
  - PocketBase migration files (`pb_migrations/*.js`) — define the schema.
  - The existing xlsx fixtures (`anesthesiology_mapping.xlsx`,
    `board_specialty_mapping_competencies.xlsx`, `anesthesiology_milestones.txt`).
  - The new `npm run seed:local` script (port of today's `seed:convex`).

Result: any clone reproduces the exact same DB. The "single file accessible
without external provider" goal is met — the recipe lives in git, the file
is regenerated on demand. Same model as our current Convex seed flow.

**Personal backups**: developers can `cp pb_data/data.db ~/backups/...` —
just don't push them.

---

## Optional: BigQuery as analytics sink

We have an existing GCP / BigQuery investment. Not a primary store (wrong
shape for OLTP), but a natural downstream destination for reporting.

- Nightly cron exports PocketBase tables → BigQuery via `bq load` from a
  JSON dump, OR a small Node script using `@google-cloud/bigquery`.
- Append-only fact tables (extraction runs, mapping events) are particularly
  natural for BQ.
- **Live app stays on PocketBase** for OLTP. BigQuery is read-only downstream.
- Defer until a concrete reporting need is on the table.

---

## Migration scope (what changes vs. today)

| Layer | Today (Convex / Vercel) | After (PocketBase / Auth.js) |
|---|---|---|
| Data layer | `convex/queries.ts` + `convex/mutations.ts` | PocketBase REST/SDK from `src/lib/db/` |
| Schema | `convex/schema/*.ts` | `pb_migrations/*.js` |
| Reactivity | Convex `useQuery` hooks | `pb.collection().subscribe('*', cb)` |
| Auth | Convex Auth + email allowlist + JWT keys | Auth.js Google provider + domain check |
| Workflows | `'use workflow'` + `withWorkflow()` + `WORKFLOW_SECRET` cross-deploy | Plain async calling PocketBase SDK (or keep WDK durability — open question) |
| Blob storage | Vercel Blob (`BLOB_READ_WRITE_TOKEN`) | PocketBase built-in file fields |
| Per-user AI keys | Convex `userApiKeys` table | PocketBase `user_api_keys` collection |
| `src/proxy.ts` | Convex Auth middleware | Auth.js session check |
| Cache invalidation | `revalidateTag` (Next.js native) | Unchanged |
| Env vars | ~14 vars including cross-deploy secrets | ~7 vars (`POCKETBASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AMBOSS_MCP_URL/TOKEN`) |

Removed entirely: `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`,
`WORKFLOW_SECRET`, `BLOB_READ_WRITE_TOKEN`, `INTERNAL_REVALIDATE_SECRET`,
`STAFF_EMAIL_ALLOWLIST`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` (on Convex).

---

## Open questions (for review)

1. **Where does PocketBase production run?** k8s on Content Platform's
   cluster, AWS EC2, or Hetzner VPS?
2. **Stay on Vercel for Next.js, or co-locate?** Recommendation: stay on
   Vercel for now.
3. **Pin PocketBase binary in the repo, or download via setup script?**
   Pinning (~25 MB committed) guarantees version consistency; downloading
   keeps the repo small but adds a network dependency.
4. **Keep Vercel Workflow durability?** Or rip out `withWorkflow` and use
   plain async functions calling PocketBase directly? Plain async is simpler
   if we don't need crash-safe step replay.
5. **Per-user AI keys** — keep the per-user concept (PocketBase
   `user_api_keys` collection) or simplify to env-only? Recommendation:
   env-only for a small internal team.
6. **BigQuery sink** — implement now, or defer until a reporting need is
   concrete? Recommendation: defer.
7. **Bootstrap data**: do we need to migrate existing Convex data, or is
   re-seeding from xlsx fixtures sufficient? (The current scripts already
   support full re-seed.)

---

## What happens after sign-off

Once this proposal is approved, we'll produce:

1. **`DEPLOYMENT.md`** — runbook for the **current** Convex/Vercel setup.
   Captures the wiring before the Vercel project is deleted, so we have a
   complete reference of what existed.
2. **`DEPLOYMENT_POCKETBASE.md`** — full runbook for the new architecture
   (local dev + production deployment + auth + backups + optional
   BigQuery sink).
3. The migration work itself (separate PRs):
   - Bootstrap script for PocketBase collections matching current schema
   - Port of `src/lib/db/` from Convex to PocketBase SDK
   - Auth.js wiring + `src/proxy.ts` rewrite
   - Port of seed scripts to write to PocketBase
   - Removal of Convex / Vercel Workflow / Vercel Blob code paths
   - Production deployment of PocketBase on chosen host

Until that work lands, the current Convex/Vercel system continues to run
as-is.
