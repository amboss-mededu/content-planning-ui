import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { contentInputShape, jsonBlobString, mappingFilterShape } from './_shared';

// Pipeline state. Vercel Workflow durability is managed by the runtime;
// these tables are application-level state the workflow code chooses to
// persist (run history, stage progression, structured event log, and the
// staging table for codes pending approval).
//
// `outputSummary` / `draftPayload` / `metrics` / `metadata` stay as
// JSON-stringified strings — their shape varies per stage / per event and
// pinning them to a Convex validator would impose churn for no real benefit.

export const pipelineTables = {
  pipelineRuns: defineTable({
    specialtySlug: v.string(),
    status: v.string(),
    workflowRunId: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    contentOutlineUrls: v.optional(v.array(contentInputShape)),
    identifyModulesInstructions: v.optional(v.string()),
    extractCodesInstructions: v.optional(v.string()),
    milestonesInstructions: v.optional(v.string()),
    mappingInstructions: v.optional(v.string()),
    mappingCheckIds: v.boolean(),
    mappingFilter: v.optional(mappingFilterShape),
    // Actor audit trail. Set when a user triggers the run via an authenticated
    // request; left undefined for workflow-internal create paths and legacy
    // rows from before this field existed.
    createdByUserId: v.optional(v.string()),
  })
    .index('by_specialty', ['specialtySlug'])
    .index('by_specialty_started', ['specialtySlug', 'startedAt']),

  pipelineStages: defineTable({
    runId: v.string(),
    stage: v.string(),
    status: v.string(),
    workflowRunId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
    outputSummary: jsonBlobString,
    draftPayload: jsonBlobString,
    errorMessage: v.optional(v.string()),
  })
    .index('by_run', ['runId'])
    .index('by_run_stage', ['runId', 'stage']),

  pipelineEvents: defineTable({
    runId: v.string(),
    stage: v.string(),
    level: v.string(),
    message: v.string(),
    metrics: jsonBlobString,
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_run_stage_created', ['runId', 'stage', 'createdAt']),

  extractedCodes: defineTable({
    runId: v.string(),
    specialtySlug: v.string(),
    code: v.string(),
    category: v.optional(v.string()),
    consolidationCategory: v.optional(v.string()),
    description: v.optional(v.string()),
    source: v.optional(v.string()),
    metadata: jsonBlobString,
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_specialty', ['specialtySlug']),
};
