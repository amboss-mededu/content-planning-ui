# amboss-content-planner-ui

Internal AMBOSS staff tool for planning medical-content coverage per specialty. Editors trigger durable, multi-stage AI pipelines that extract clinical concepts from board-review PDFs, map them against existing AMBOSS articles, and consolidate gaps into editorial decisions.

> **New here?** Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system overview, module map, and conventions. Read [`AGENTS.md`](AGENTS.md) for design-system + repo-specific tips.

---

## Quickstart

### 1. Install + provision

```bash
npm install
cp .env.example .env.local        # then fill in secrets — see below
```

Fetch the PocketBase binary (one time):

```bash
./bin/get-pocketbase.sh           # downloads + verifies pinned release into bin/
```

Configure Google OAuth (one time, per deployment):

```bash
# Add GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET +
# POCKETBASE_URL / POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD to .env.local
npm run configure-oauth           # pushes the OAuth client onto the local PB instance
```

Authorized redirect URI for the Google client: `http://localhost:3000/auth/callback/google`.

### 2. Run

Two terminals:

```bash
./bin/pocketbase serve            # PocketBase on :8090, admin UI at :8090/_/
npm run dev                       # Next.js on :3000
```

Sign in is restricted by domain (`@amboss.com`, `@medicuja.com`, `@miamed.de`) — enforced server-side in `pb_hooks/main.pb.js`.

### 3. Seed data (optional)

```bash
npm run import-board                 # specialty registry from board_specialty_mapping_competencies.xlsx
npm run seed:local                   # editor tables + ontology from anesthesiology_mapping.xlsx
npm run import-milestones -- anesthesiology anesthesiology_milestones.txt
```

See `package.json#scripts` for the full list.

---

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome check |
| `npm run lint:fix` | Biome check + write fixes |
| `npm test` | Vitest |
| `npm run test:e2e` | Playwright |
| `/security-review` | Local security review of pending changes (Claude Code slash command) |

CI runs typecheck + lint + test + e2e + an [AI security review](.github/workflows/security-review.yml) on every PR.

---

## Deployment

Self-hosted: a long-lived `next start` Node server alongside the PocketBase binary (PB owns the SQLite file + uploaded files in `pb_data/`). See [`DEPLOYMENT_POCKETBASE.md`](DEPLOYMENT_POCKETBASE.md) for the full runbook (env vars, OAuth setup, backups, open questions).

The previous Convex + Vercel + Workflow + Blob stack is documented for reference in [`DEPLOYMENT.md`](DEPLOYMENT.md) and was retired in the migration captured by [`MIGRATION_PROPOSAL.md`](MIGRATION_PROPOSAL.md).

---

## Repo conventions

- **Default to server components.** Mark `'use client'` only when needed — see `AGENTS.md` for design-system caveats.
- **PocketBase is the source of truth.** RSC + route handlers use the cookie-authed client (`src/lib/pb/server.ts#createServerClient`); background pipeline code uses `createAdminClient`. The data-layer wrappers in `src/lib/data/*` are the only files that talk to PB directly.
- **Pipeline stages run as plain async functions.** Trigger routes in `src/app/api/workflows/*` spawn them fire-and-forget (`void runAsync().catch(log)`); approval-gated stages split into `*Phase1` / `*Phase2`, with phase1 stashing the draft on `pipelineStages.draftPayload` and phase2 invoked from `/api/workflows/approve`. The Vercel Workflow runtime is gone.
- **No string-blob columns for new data.** LLM output that uses natural-language keys must be transformed to array-of-records before storage. PB `json` fields hold the parsed shape directly — no JSON.stringify/parse boundary.

> The architecture and migrations docs under `docs/` were written against the Convex stack and have not yet been refreshed. Trust this README and `DEPLOYMENT_POCKETBASE.md` for the current setup until those are rewritten.

---

## Project status

The codebase is mid-2026 internal-tool stage: post-launch foundations are landing (auth + audit + rate-limit + dependency hygiene), and the next phase is cleanup before adding **literature search → PDF curation → article generation** workflows. See [`docs/ARCHITECTURE.md#future-modules`](docs/ARCHITECTURE.md#future-modules) for the module placeholders.
