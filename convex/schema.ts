/**
 * Convex schema aggregator — shrinking as PRs port domains to PocketBase.
 * The whole convex/ directory disappears in PR 9 cleanup. Remaining
 * domains: pipeline + extractedCodes (PR 5), userApiKeys (PR 5).
 */

import { defineSchema } from 'convex/server';
import { pipelineTables } from './schema/pipeline';
import { userApiKeysTables } from './schema/userApiKeys';

export default defineSchema({
  ...pipelineTables,
  ...userApiKeysTables,
});
