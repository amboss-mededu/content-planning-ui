/* eslint-disable */
/**
 * Generated `api` utility — manually pruned during the PocketBase auth
 * cutover (PR 3) to drop references to deleted modules: ResendOTP,
 * ResendOTPPasswordReset, auth, http, otpRateLimit, schema/otp, users.
 *
 * Originally written by `npx convex codegen`. Will be deleted along with
 * the rest of convex/ in the cleanup PR.
 *
 * @module
 */

import type * as _lib_access from "../_lib/access.js";
import type * as amboss from "../amboss.js";
import type * as apiKeys from "../apiKeys.js";
import type * as articles from "../articles.js";
import type * as categories from "../categories.js";
import type * as codes from "../codes.js";
import type * as ontology from "../ontology.js";
import type * as overview from "../overview.js";
import type * as pipeline from "../pipeline.js";
import type * as schema__shared from "../schema/_shared.js";
import type * as schema_amboss from "../schema/amboss.js";
import type * as schema_articles from "../schema/articles.js";
import type * as schema_codes from "../schema/codes.js";
import type * as schema_ontology from "../schema/ontology.js";
import type * as schema_pipeline from "../schema/pipeline.js";
import type * as schema_sections from "../schema/sections.js";
import type * as schema_sources from "../schema/sources.js";
import type * as schema_specialties from "../schema/specialties.js";
import type * as schema_userApiKeys from "../schema/userApiKeys.js";
import type * as sections from "../sections.js";
import type * as sources from "../sources.js";
import type * as specialties from "../specialties.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_lib/access": typeof _lib_access;
  amboss: typeof amboss;
  apiKeys: typeof apiKeys;
  articles: typeof articles;
  categories: typeof categories;
  codes: typeof codes;
  ontology: typeof ontology;
  overview: typeof overview;
  pipeline: typeof pipeline;
  "schema/_shared": typeof schema__shared;
  "schema/amboss": typeof schema_amboss;
  "schema/articles": typeof schema_articles;
  "schema/codes": typeof schema_codes;
  "schema/ontology": typeof schema_ontology;
  "schema/pipeline": typeof schema_pipeline;
  "schema/sections": typeof schema_sections;
  "schema/sources": typeof schema_sources;
  "schema/specialties": typeof schema_specialties;
  "schema/userApiKeys": typeof schema_userApiKeys;
  sections: typeof sections;
  sources: typeof sources;
  specialties: typeof specialties;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
