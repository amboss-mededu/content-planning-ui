/**
 * Stub. The real Convex Auth wiring (Password provider, ResendOTP, JWT
 * keypair, domain allowlist) was removed in PR 3 of the PocketBase
 * migration. This module exists so the remaining Convex queries
 * (convex/_lib/access.ts, convex/apiKeys.ts, convex/pipeline.ts) still
 * compile until they're ported to PocketBase in PRs 4–5 and the entire
 * convex/ directory is deleted in PR 9.
 *
 * Authentication for the live app now happens in src/proxy.ts +
 * src/lib/auth/index.ts via the PocketBase HttpOnly cookie. Any Convex
 * function that calls `auth.getUserId(ctx)` will see null and throw via
 * `requireUser` — fine because the wiped Convex DB makes those queries
 * non-functional anyway.
 */
import type { GenericQueryCtx } from 'convex/server';
import type { DataModel } from './_generated/dataModel';

export const auth = {
  getUserId: async (_ctx: GenericQueryCtx<DataModel>): Promise<string | null> => null,
};
