# DEPLOYMENT_POCKETBASE.md — PocketBase architecture (target)

> **Status: ASPIRATIONAL — migration in progress.** This describes the
> target architecture that replaces Convex + Vercel Workflow + Vercel
> Blob with self-hosted PocketBase + Google OAuth. The migration ships
> as a series of PRs against `migration/integration`; this banner is
> removed in the final cleanup PR. For the architecture rationale see
> [`MIGRATION_PROPOSAL.md`](./MIGRATION_PROPOSAL.md). For the previous
> Convex/Vercel setup see [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Stack

- **Next.js 16** (App Router, React 19, `cacheComponents: true`) —
  unchanged.
- **PocketBase** (single Go binary + SQLite) for all data + real-time
  subscriptions + file storage + auth.
- **Google OAuth** via PocketBase's built-in `authWithOAuth2Code` —
  domain-restricted to `@amboss.com` / `@medicuja.com` / `@miamed.de`
  enforced by a `pb_hooks/main.pb.js` hook.
- **No Vercel Workflow** (replaced by plain async — see PR 6 of the
  migration; can be re-evaluated if durability becomes required).
- **No Vercel Blob** (replaced by PocketBase file fields).
- **AMBOSS MCP** (external) — unchanged.
- **AI providers** — keys per-user (PocketBase `userApiKeys` collection)
  with optional env fallbacks.

## Prerequisites

- **Node** 24
- **npm** 11.9.0
- **PocketBase binary** — `bin/pocketbase`, downloaded by
  `bin/get-pocketbase.sh` (gitignored). The script pins a specific
  release version + verifies the SHA256.
- **Google OAuth credentials** from Google Cloud Console:
  - One client per environment (local / preview / prod).
  - Authorized redirect URI: `http://localhost:3000/auth/callback/google`
    (local) or `https://<host>/auth/callback/google` (deployed).
- **AMBOSS MCP token** + provider API keys (Gemini / Anthropic /
  OpenAI) — same as before.

## Local development

```bash
git clone git@github.com:bsk-amboss/content-planning-ui.git
cd content-planning-ui
npm ci

# Acquire and start PocketBase
./bin/get-pocketbase.sh             # downloads + verifies binary
./bin/pocketbase serve --dir=./pb_data &   # admin UI on :8090/_/

# First-run admin setup: visit http://localhost:8090/_/
# (collections + hooks are auto-applied from pb_migrations/ + pb_hooks/)

# Seed the DB from the committed xlsx fixtures
npm run seed:local

# Run the app
npm run dev                         # :3000
```

`pb_data/` is gitignored — the DB is regenerated from
`pb_migrations/*.js` + `pb_hooks/main.pb.js` + xlsx fixtures via
`npm run seed:local`.

## Production — pick one host

PocketBase **cannot run on Vercel** (ephemeral filesystem; serverless
spins instances up/down; no persistent disk for the SQLite file). It
needs one long-running stateful process. Three viable patterns:

### Option A — Kubernetes (preferred if Content Platform runs k8s)

```yaml
# Sketch — actual manifests will live with Content Platform
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 1                       # single-writer SQLite
  template:
    spec:
      containers:
        - name: pocketbase
          image: <internal-registry>/pocketbase:0.26.x
          ports: [{ containerPort: 8090 }]
          volumeMounts:
            - { name: data, mountPath: /pb_data }
          resources:
            requests: { cpu: 200m, memory: 256Mi }
            limits:   { cpu: 1,    memory: 1Gi }
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: pocketbase-data
---
apiVersion: v1
kind: PersistentVolumeClaim
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 20Gi } }
```

Plus a `Service` (ClusterIP) on 8090, an `Ingress` with TLS via
cert-manager → `pb.<our-domain>`, and a `CronJob` running
`pocketbase backup` nightly with the snapshot uploaded to S3 / GCS.

### Option B — AWS EC2

- One `t4g.small` (ARM, ~$13/mo) with an EBS volume mounted at
  `/var/lib/pocketbase`.
- Run as a `systemd` service (sample unit below).
- ALB or direct DNS + Caddy for TLS.
- AWS Backup snapshots EBS nightly; or PocketBase backups → S3 via
  cron.

### Option C — Hetzner / internal VPS (privacy-maximalist)

- €5–20/mo VM (Hetzner EU-Central, Frankfurt) for data residency.
- Same systemd + Caddy pattern.
- Backups → Hetzner Storage Box.

### Sample systemd unit (Options B & C)

```ini
# /etc/systemd/system/pocketbase.service
[Unit]
Description=PocketBase
After=network.target

[Service]
Type=simple
User=pocketbase
ExecStart=/opt/pocketbase/pocketbase serve --http=127.0.0.1:8090 --dir=/var/lib/pocketbase
Restart=on-failure
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

### Sample Caddy config

```
pb.example.com {
    reverse_proxy localhost:8090
}

app.example.com {
    reverse_proxy localhost:3000   # if Next.js is co-located
}
```

## Where Next.js runs

Two options, **independent** of where PocketBase runs:

| | Pros | Cons |
|---|---|---|
| **Stay on Vercel** + remote PocketBase | Keep current Vercel DX (preview URLs, Analytics, Speed Insights). Frontend doesn't store data; only proxies API + auth. | Frontend still on Vercel infrastructure. |
| **Co-locate Next.js + PocketBase** on the same VPS / k8s | Fully self-hosted. | Lose Vercel ergonomics; more ops work. |

**Recommended**: stay on Vercel for Next.js (no data lives there) +
remote PocketBase on chosen host. Switch to fully self-hosted later
if Vercel itself becomes a concern.

## Authentication — Google OAuth via PocketBase

PocketBase ships with built-in OAuth2. We use the `authWithOAuth2Code`
flow because it works with App Router server-side redirects:

1. User clicks "Sign in with Google" → app builds the Google
   authorization URL + state token, sets a `pkce_verifier` cookie,
   redirects to Google.
2. Google redirects back to `/auth/callback/google?code=...&state=...`.
3. The route handler calls
   `pb.collection('users').authWithOAuth2Code('google', code, verifier, redirectUrl)`.
4. PocketBase exchanges the code with Google, creates / updates the
   `users` record, returns an auth token.
5. The token is exported into an HttpOnly cookie via
   `pb.authStore.exportToCookie()` and the user is redirected to
   the post-login destination.

### Domain restriction (server-side hook)

Lives in `pb_hooks/main.pb.js` — runs on the PocketBase server, not in
app code, so it's enforced regardless of how the OAuth call is
initiated:

```js
// pb_hooks/main.pb.js (sketch — final form lands in PR 2)
onRecordBeforeAuthWithOAuth2Request((e) => {
  const allowed = ['amboss.com', 'medicuja.com', 'miamed.de'];
  const email = (e.oauth2User?.email || '').toLowerCase();
  const domain = email.split('@')[1];
  if (!allowed.includes(domain)) {
    throw new BadRequestError(`Sign-in restricted to AMBOSS staff (${allowed.join(' / ')}).`);
  }
}, 'users');
```

For an explicit allowlist (replaces the legacy `STAFF_EMAIL_ALLOWLIST`),
read a comma-separated env var inside the hook.

### Server-side session validation

`src/proxy.ts` runs on every request matching the protected route
matcher:

```ts
// sketch — final form lands in PR 3
import PocketBase from 'pocketbase';

export default async function proxy(request: NextRequest) {
  const pb = new PocketBase(env.POCKETBASE_URL);
  pb.authStore.loadFromCookie(request.headers.get('cookie') ?? '');

  try {
    if (pb.authStore.isValid) await pb.collection('users').authRefresh();
  } catch {
    pb.authStore.clear();
  }

  const isAuthenticated = pb.authStore.isValid;
  // … existing redirect logic, unchanged
}
```

## Required environment variables

Validated by `src/env.ts` (`@t3-oss/env-nextjs`); build fails fast on
missing required vars.

| Var | Scope | Required | Notes |
|---|---|---|---|
| `POCKETBASE_URL` | server | yes | `http://localhost:8090` (local) / `https://pb.<host>` (prod). |
| `NEXT_PUBLIC_POCKETBASE_URL` | client | yes | Same value, exposed for client SDK. |
| `POCKETBASE_ADMIN_EMAIL` | server | yes (server SDK calls / scripts) | Used by seed scripts + server-only admin operations. |
| `POCKETBASE_ADMIN_PASSWORD` | server | yes (server SDK calls / scripts) | Same. |
| `GOOGLE_OAUTH_CLIENT_ID` | server | yes | From Google Cloud Console. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | server | yes | Same. |
| `AMBOSS_MCP_URL` | server | optional | Mapping agent's tool backend. |
| `AMBOSS_MCP_TOKEN` | server | optional | Bearer token. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | server | optional fallback | Per-user keys preferred. |
| `ANTHROPIC_API_KEY` | server | optional fallback | |
| `OPENAI_API_KEY` | server | optional fallback | |
| `GOOGLE_SA_CLIENT_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` / `MAPPING_SHEET_IDS` / `LOCAL_XLSX_FIXTURES` | server | optional | Google Sheets integration — unchanged. |

**Removed vs. previous setup**: `CONVEX_DEPLOYMENT`,
`NEXT_PUBLIC_CONVEX_URL`, `WORKFLOW_SECRET`,
`INTERNAL_REVALIDATE_SECRET`, `BLOB_READ_WRITE_TOKEN`,
`STAFF_EMAIL_ALLOWLIST`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`.

## Backups

PocketBase has a built-in `backup` command that produces a consistent
`.zip` snapshot. Pattern:

```bash
# Cron entry (nightly)
0 3 * * * /opt/pocketbase/pocketbase backup --dir=/var/lib/pocketbase \
  && aws s3 cp /var/lib/pocketbase/pb_data/backups/<latest>.zip \
       s3://amboss-pocketbase-backups/$(date +%Y/%m/%d)/
```

For k8s: a `CronJob` running the same command against a sidecar or
exec'd into the PocketBase pod.

**Restore**: stop PocketBase, replace `pb_data/` with the unzipped
snapshot, restart.

## Data sharing across the team

The DB itself is **not** committed. Anyone clones the repo and gets
the same DB by running the seed script.

- ❌ **Don't commit** `pb_data/data.db` ([sqlite.org/whynotgit.html](https://sqlite.org/whynotgit.html)).
- ✅ **Do commit**:
  - `pb_migrations/*.js` — collection definitions.
  - `pb_hooks/*.js` — server hooks (domain restriction etc.).
  - The xlsx fixtures (`anesthesiology_mapping.xlsx`,
    `board_specialty_mapping_competencies.xlsx`,
    `anesthesiology_milestones.txt`).
  - `npm run seed:local` (lands in PR 8).

## (Re)seeding scripts

Same script names as before; targets PocketBase instead of Convex
(rewired in PR 8 of the migration).

```bash
npm run seed:local              # full reseed from xlsx fixtures
npm run seed:ontology           # ICD-10 / HCUP / ABIM / Orpha
npm run import-board            # board specialty mapping
npm run import-milestones       # milestone competency text
npm run mark-imported           # post-import flag
npm run refresh-amboss-library  # AMBOSS library snapshot
```

All require `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`,
`POCKETBASE_ADMIN_PASSWORD` in `.env.local`.

## Verification

### Local

1. `./bin/get-pocketbase.sh` — binary downloaded, executable.
2. `./bin/pocketbase serve` — admin UI at `http://localhost:8090/_/`.
3. Open admin UI — confirm ~16 collections (`specialties`, `codes`,
   `pipelineRuns`, etc.) with correct fields + indexes; confirm the
   `users` collection has Google OAuth provider enabled and the
   domain-restriction hook is loaded.
4. `npm run seed:local` — populates collections without error.
5. `npm run dev` → `http://localhost:3000`. Click "Sign in with Google".
6. Allowlisted Google account → signs in, redirected to `/`.
7. Non-allowlisted account → rejected with the staff-only message.
8. Trigger an extraction; rows appear in the PocketBase admin UI in
   real time; React UI updates without a manual refresh.

### Production

Same flow against the deployed URLs:

1. TLS valid on both `pb.<host>` and the app host.
2. Google OAuth redirect URI matches the deployed host.
3. Nightly backup ran (check S3 / GCS / Storage Box).
4. `pocketbase --version` matches the version pinned in
   `bin/get-pocketbase.sh`.

## Optional: BigQuery analytics sink

For org-wide reporting on planning activity, leveraging the existing
GCP investment. **Not** a primary store — OLAP shape, wrong tool for
editor UX. Treat as downstream-only.

- Nightly cron exports PocketBase tables → BigQuery via `bq load`
  from a JSON dump, OR a small Node script using
  `@google-cloud/bigquery`.
- Append-only fact tables (extraction runs, mapping events) are
  particularly natural for BQ.
- Live app stays on PocketBase for OLTP; BQ is read-only downstream.
- **Defer until a concrete reporting need lands.**

## Open questions (carried over from MIGRATION_PROPOSAL.md)

1. Where does PocketBase production run? (k8s / EC2 / Hetzner — see
   options above.)
2. Stay on Vercel for Next.js, or co-locate?
3. Pin the PocketBase binary in the repo, or download via setup script?
   (Current default in PR 2: download via script with pinned version
   + SHA256.)
4. Keep Vercel Workflow durability, or rip out for plain async?
   (Current plan in PR 6: rip out — pipeline stages are idempotent.)
5. Per-user AI keys via `userApiKeys` collection, or env-only?
6. BigQuery sink — implement now or defer?

---

For the previous architecture see [`DEPLOYMENT.md`](./DEPLOYMENT.md).
For the migration's PR-by-PR plan see
[`MIGRATION_PROPOSAL.md`](./MIGRATION_PROPOSAL.md) — the full plan
also lives in `.claude/plans/i-need-to-delete-eventual-thimble.md`.
