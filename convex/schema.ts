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
import { userApiKeysTables } from './schema/userApiKeys';

// Schema modules are deleted domain-by-domain across PRs 4 and 5; the
// whole convex/ directory disappears in PR 9 cleanup. Specialties was
// the first domain ported (PR 4 commit 1).
export default defineSchema({
  ...codesTables,
  ...articlesTables,
  ...sectionsTables,
  ...ontologyTables,
  ...ambossTables,
  ...sourcesTables,
  ...pipelineTables,
  ...userApiKeysTables,
});
