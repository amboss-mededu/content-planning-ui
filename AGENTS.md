<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:amboss-design-system -->
## AMBOSS design system

This project consumes `@amboss/design-system`. The `amboss-ds` MCP serves the live component catalog — every prop signature, variant, default, and example story comes from the published Storybook. Documented MCP behavior is the source of truth. The package's exported TypeScript types are the fallback when the MCP does not cover a question.

### Triggers — call the MCP when

- The work touches a visual primitive (button, input, layout container, dialog, list, badge, icon, etc.). Check whether the design system already ships it before writing custom code.
- Code under review hand-rolls UI that the design system likely covers: raw `<div onClick>`, ad-hoc flex containers, hex-coded colors, bespoke modal portals, custom focus-trapping. Check the catalog before recommending a refactor or signing off.
- You are about to use a design-system component but are not certain about a prop name, a variant value, or a default.
- The user names a component or prop you have not inspected this session.

### Protocol

1. `list-all-documentation` — call once per task to enumerate the catalog. The returned IDs are the only valid component references; never invent one.
2. `get-documentation` with a catalog ID — read the prop signature, variants, defaults, and example stories before writing JSX or making a recommendation.
3. `get-documentation-for-story` — call when a specific story variant carries detail beyond what `get-documentation` returned.
4. If the MCP does not answer a question, inspect the exported TypeScript types from `@amboss/design-system` and treat the type as authoritative for that question.

### Rules

- Documented MCP behavior wins. When `get-documentation` specifies a default, a variant string, or a usage pattern, follow it.
- Types are the fallback, not an override. Use them to resolve questions the MCP does not cover; do not use them to contradict what the MCP documents.
- Quote components in recommendations using prop names, variant strings, and defaults read from the MCP this session — not from memory or analogy.
- When neither the MCP nor the types cover what the user needs, surface the gap explicitly. Ask whether to request a new component, ship a custom implementation, or use the closest available match. Do not silently substitute.
<!-- END:amboss-design-system -->

<!-- BEGIN:extension-points -->
## Extension points

- **Auth**: `src/lib/auth/index.ts` wires `getCurrentUser` / `isAuthenticated` / `requireUserResponse` to the cookie-authed PocketBase client. Request-time gating lives in `src/proxy.ts` (the renamed Next 16 middleware). Email allowlist enforcement is server-side in `pb_hooks/main.pb.js`.
- **Database**: PocketBase is the source of truth. Server-side reads/writes go through `src/lib/data/*` (which use the clients in `src/lib/pb/server.ts`); browser-side live queries go through `useLiveCollection` from `src/lib/pb/use-live-collection.ts`.
- **Env vars**: Declare in `src/env.ts` under `server` or `client` schemas; `next.config.ts` imports it so builds fail fast on missing vars. Local overrides go in `.env.local` (see `.env.example`).
- **Deployment**: Self-hosted — `next start` Node server alongside the PocketBase binary. See [`DEPLOYMENT_POCKETBASE.md`](DEPLOYMENT_POCKETBASE.md) for the runbook.
<!-- END:extension-points -->