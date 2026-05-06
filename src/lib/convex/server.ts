/**
 * Thin server-side wrappers around `convex/nextjs` helpers, retained so the
 * 37 call sites that haven't been ported off Convex yet still compile.
 *
 * The Convex Auth token attachment was removed as part of the auth cutover
 * (PR 3 of the migration). These wrappers now pass through to fetchQuery /
 * fetchMutation / preloadQuery without an auth token — Convex calls will
 * fail at runtime against the wiped DB, which is expected. PRs 4–5 replace
 * each call site with PocketBase SDK calls, then this file gets deleted in
 * the final cleanup.
 */

import {
  fetchMutation,
  fetchQuery,
  type NextjsOptions,
  preloadQuery,
} from 'convex/nextjs';
import type { FunctionReference } from 'convex/server';

export async function fetchQueryAsUser<Q extends FunctionReference<'query', 'public'>>(
  fn: Q,
  args?: Q['_args'],
  options?: NextjsOptions,
): Promise<Q['_returnType']> {
  return fetchQuery(fn, args ?? ({} as Q['_args']), options);
}

export async function fetchMutationAsUser<
  M extends FunctionReference<'mutation', 'public'>,
>(fn: M, args?: M['_args'], options?: NextjsOptions): Promise<M['_returnType']> {
  return fetchMutation(fn, args ?? ({} as M['_args']), options);
}

export async function preloadQueryAsUser<Q extends FunctionReference<'query', 'public'>>(
  fn: Q,
  args?: Q['_args'],
  options?: NextjsOptions,
) {
  return preloadQuery(fn, args ?? ({} as Q['_args']), options);
}
