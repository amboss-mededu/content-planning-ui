/**
 * Per-code mapping run metadata loader. Reads `pipelineEvents` from PocketBase
 * for the most recent `map_codes` run that touched a specific code, and
 * returns per-attempt usage + aggregate totals. Powers the Metadata tab in
 * the code-detail modal.
 */

import type { EventMetrics } from '@/lib/workflows/lib/events';
import { getCodeRunMetadataPipeline } from './pipeline';

export type CodeRunAttempt = {
  createdAt: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  model: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  mcpToolCalls: number | null;
  mcpToolNames: string[] | null;
  attempts: number | null;
  invalidIds: string[] | null;
};

export type CodeRunMetadata = {
  runId: string;
  runStartedAt: string;
  runFinishedAt: string | null;
  stageStatus: string | null;
  finalModel: string | null;
  totals: {
    costUsd: number | null;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    durationMs: number;
    mcpToolCalls: number;
  };
  toolBreakdown: Array<{ name: string; count: number }>;
  attempts: CodeRunAttempt[];
};

export async function loadCodeMappingMetadata(
  slug: string,
  code: string,
): Promise<CodeRunMetadata | null> {
  const result = await getCodeRunMetadataPipeline(slug, code);
  if (!result) return null;

  const attempts: CodeRunAttempt[] = result.events.map((e) => {
    const m = (e.metrics ?? {}) as EventMetrics;
    return {
      createdAt: e.createdAt.toISOString(),
      level: (e.level as 'info' | 'warn' | 'error') ?? 'info',
      message: e.message,
      model: m.model ?? null,
      durationMs: typeof m.durationMs === 'number' ? m.durationMs : null,
      inputTokens: typeof m.inputTokens === 'number' ? m.inputTokens : null,
      outputTokens: typeof m.outputTokens === 'number' ? m.outputTokens : null,
      reasoningTokens: typeof m.reasoningTokens === 'number' ? m.reasoningTokens : null,
      costUsd: typeof m.costUsd === 'number' ? m.costUsd : null,
      mcpToolCalls: typeof m.mcpToolCalls === 'number' ? m.mcpToolCalls : null,
      mcpToolNames: Array.isArray(m.mcpToolNames) ? m.mcpToolNames : null,
      attempts: typeof m.attempts === 'number' ? m.attempts : null,
      invalidIds: Array.isArray(m.invalidIds) ? m.invalidIds : null,
    };
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let durationMs = 0;
  let mcpToolCalls = 0;
  let costUsd = 0;
  let anyCost = false;
  const toolCounts = new Map<string, number>();
  let finalModel: string | null = null;
  for (const a of attempts) {
    if (a.inputTokens) inputTokens += a.inputTokens;
    if (a.outputTokens) outputTokens += a.outputTokens;
    if (a.reasoningTokens) reasoningTokens += a.reasoningTokens;
    if (a.durationMs) durationMs += a.durationMs;
    if (a.mcpToolCalls) mcpToolCalls += a.mcpToolCalls;
    if (typeof a.costUsd === 'number') {
      costUsd += a.costUsd;
      anyCost = true;
    }
    if (a.mcpToolNames) {
      for (const name of a.mcpToolNames) {
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      }
    }
    if (a.model && a.model !== 'mapper-ladder') finalModel = a.model;
  }

  const toolBreakdown = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((x, y) => y.count - x.count);

  return {
    runId: result.run.id,
    runStartedAt: result.run.startedAt.toISOString(),
    runFinishedAt: result.run.finishedAt ? result.run.finishedAt.toISOString() : null,
    stageStatus: result.stage?.status ?? null,
    finalModel,
    totals: {
      costUsd: anyCost ? costUsd : null,
      inputTokens,
      outputTokens,
      reasoningTokens,
      durationMs,
      mcpToolCalls,
    },
    toolBreakdown,
    attempts,
  };
}
