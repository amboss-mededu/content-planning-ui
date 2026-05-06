/* eslint-disable */
/**
 * Generated `api` utility — manually pruned during the migration.
 *
 * After PR 5 (data layer batch 2) the entire data layer lives in
 * PocketBase and no app code imports `api.*` anymore. This file is
 * kept as an empty placeholder so the still-existing `convex/_lib/`
 * helper compiles. It (along with the rest of convex/) disappears in
 * PR 9 cleanup.
 *
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

declare const fullApi: ApiFromModules<Record<string, never>>;

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;

export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, 'internal'>
>;

export declare const components: {};
