/**
 * Convex schema aggregator.
 *
 * Per-domain table definitions live in `convex/schema/<domain>.ts`. Adding a
 * new domain: drop a `<domain>Tables` export there, import + spread it here.
 *
 * Single-DB Convex setup. Holds editor-facing data, ontologies, AMBOSS
 * library mirror, pipeline state, auth tables, and rate-limit counters.
 *
 * For shape conventions (jsonBlob vs jsonBlobString, ASCII-only field-name
 * rule) see `convex/schema/_shared.ts`. Phase B2 of the architecture
 * cleanup will normalise the `jsonBlobString` columns to typed
 * arrays-of-records.
 */

import { defineSchema } from 'convex/server';
import { ambossTables } from './schema/amboss';
import { articlesTables } from './schema/articles';
import { codesTables } from './schema/codes';
import { ontologyTables } from './schema/ontology';
import { pipelineTables } from './schema/pipeline';
import { sectionsTables } from './schema/sections';
import { sourcesTables } from './schema/sources';
import { specialtiesTables } from './schema/specialties';
import { userApiKeysTables } from './schema/userApiKeys';

// authTables + otpTables removed in the auth cutover (PR 3 of the
// PocketBase migration); the entire convex/ directory gets deleted in
// the final cleanup PR. Until then the remaining schema modules stay
// here so the convex/_generated types still compile.
export default defineSchema({
  ...specialtiesTables,
  ...codesTables,
  ...articlesTables,
  ...sectionsTables,
  ...ontologyTables,
  ...ambossTables,
  ...sourcesTables,
  ...pipelineTables,
  ...userApiKeysTables,
});
