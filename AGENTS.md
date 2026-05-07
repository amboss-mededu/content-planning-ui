<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:amboss-design-system -->
# @amboss/design-system

This project uses `@amboss/design-system` (v3.42.0) for UI. Import everything from the package root:

```ts
import { Button, Card, Text, light, ThemeProvider } from '@amboss/design-system';
```

## Authoritative docs (version-pinned to scaffold time)

- `docs/amboss/llms-full.txt` — full component + token reference (scraped from the DS site at scaffold time, ~320 KB). **Read this before composing UI.**
- `docs/amboss/llms.txt` — shorter index with Storybook URLs per component.
- `docs/amboss/SOURCE.md` — scrape timestamp + installed DS version + refresh commands.

Live docs (network, always current): https://design-system.miamed.de/

## Key facts

- The DS is **Emotion-based**, not Tailwind. Styling goes through the ThemeProvider + component props.
- SSR is wired via `src/app/emotion-registry.tsx` (Emotion cache + `useServerInsertedHTML`). Do not remove it.
- All components are client-only. Pages that use DS components must be marked `'use client'`.
- Peer deps installed: `@emotion/react`, `@emotion/styled`, `@emotion/cache`, `@emotion/is-prop-valid`, `emotion-theming`.

Do not derive component APIs from training data — `docs/amboss/llms-full.txt` is authoritative for the installed DS version.

## Extension points

- **Auth**: `src/lib/auth/index.ts` wires `getCurrentUser` / `isAuthenticated` / `requireUserResponse` to the cookie-authed PocketBase client. Request-time gating lives in `src/proxy.ts` (the renamed Next 16 middleware). Email allowlist enforcement is server-side in `pb_hooks/main.pb.js`.
- **Database**: PocketBase is the source of truth. Server-side reads/writes go through `src/lib/data/*` (which use the clients in `src/lib/pb/server.ts`); browser-side live queries go through `useLiveCollection` from `src/lib/pb/use-live-collection.ts`.
- **Env vars**: Declare in `src/env.ts` under `server` or `client` schemas; `next.config.ts` imports it so builds fail fast on missing vars. Local overrides go in `.env.local` (see `.env.example`).
- **Deployment**: Self-hosted — `next start` Node server alongside the PocketBase binary. See [`DEPLOYMENT_POCKETBASE.md`](DEPLOYMENT_POCKETBASE.md) for the runbook.
<!-- END:amboss-design-system -->

