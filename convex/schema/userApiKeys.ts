import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const testStatus = v.union(v.literal('ok'), v.literal('failed'));

export const userApiKeysTables = {
  userApiKeys: defineTable({
    userId: v.string(),
    googleApiKey: v.optional(v.string()),
    anthropicApiKey: v.optional(v.string()),
    openaiApiKey: v.optional(v.string()),
    googleTestedAt: v.optional(v.number()),
    googleTestStatus: v.optional(testStatus),
    anthropicTestedAt: v.optional(v.number()),
    anthropicTestStatus: v.optional(v.union(v.literal('ok'), v.literal('failed'))),
    openaiTestedAt: v.optional(v.number()),
    openaiTestStatus: v.optional(v.union(v.literal('ok'), v.literal('failed'))),
    updatedAt: v.number(),
  }).index('by_userId', ['userId']),
};
