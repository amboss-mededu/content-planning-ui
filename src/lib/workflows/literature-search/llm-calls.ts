/**
 * Two Gemini calls used by the literature-search worker:
 *
 *   - generateSearchQueries: article title + concepts → array of PubMed
 *     queries (lightweight Flash model).
 *   - rankCandidates: article + PubMed candidates → ranked source rows
 *     matching the `articleSources` schema (Pro model).
 *
 * Mirrors the call shape used by `src/lib/workflows/lib/gemini.ts` —
 * `resolveModel` + `generateText` with `Output.array` for structured
 * JSON outputs. Per-call metrics are written to `pipelineEvents` so the
 * stage card surfaces tokens / cost / duration the same way as
 * `extract_codes`.
 */

import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { z } from 'zod';
import type { StageName } from '../lib/db-writes';
import { logEvent } from '../lib/events';
import { type ModelSpec, type ProviderApiKeys, resolveModel } from '../lib/llm';
import { estimateCostUsd } from '../lib/pricing';
import {
  describeJsonShape,
  recoverElementsFromText,
  recoverRawElementsFromText,
} from './json-recovery';
import {
  DEFAULT_QUERY_GENERATION_PROMPT,
  DEFAULT_RANK_CANDIDATES_PROMPT,
} from './prompts';
import type { PubmedCandidate } from './pubmed';
import { normalizeRankedSourceRows } from './ranked-source-normalization';

const QUERY_MODEL: ModelSpec = {
  provider: 'google',
  model: 'gemini-3-flash-preview',
  reasoning: 'low',
};

const RANK_MODEL: ModelSpec = {
  provider: 'google',
  model: 'gemini-3.1-pro-preview',
  reasoning: 'medium',
};

const QuerySchema = z.string();

const RankedSourceSchema = z.object({
  title: z.string(),
  doi: z.string().optional(),
  url: z.string().optional(),
  journal: z.string().optional(),
  journalNlm: z.string().optional(),
  sourceType: z
    .enum([
      'guideline',
      'systematic_review',
      'clinical_review',
      'meta_analysis',
      'case_report',
      'vet_content',
      'non_english',
      'other',
    ])
    .optional(),
  predatoryJournalRisk: z.enum(['none', 'low', 'medium', 'high', 'predatory']).optional(),
  rank: z.number().int(),
  subtopics: z.string().optional(),
  llmSummary: z.string().optional(),
  justification: z.string().optional(),
  superseded: z.boolean().optional(),
});

export type RankedSource = z.infer<typeof RankedSourceSchema>;

type NoObjectLikeError = Error & {
  text?: string;
  finishReason?: string;
  cause?: unknown;
};

function noObjectError(e: unknown): NoObjectLikeError | null {
  if (NoObjectGeneratedError.isInstance(e)) return e as NoObjectLikeError;
  if (!e || typeof e !== 'object') return null;
  const candidate = e as Partial<NoObjectLikeError> & {
    name?: string;
    constructor?: { name?: string };
  };
  if (typeof candidate.text !== 'string') return null;
  if (
    candidate.name === 'NoObjectGeneratedError' ||
    candidate.constructor?.name === 'NoObjectGeneratedError' ||
    'finishReason' in candidate
  ) {
    return candidate as NoObjectLikeError;
  }
  return null;
}

function validationSummary(e: NoObjectLikeError): string | undefined {
  const cause = e.cause;
  if (!cause || typeof cause !== 'object') return undefined;
  if ('issues' in cause) {
    const issues = (cause as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return `issues:${issues.length}`;
  }
  if (
    'message' in cause &&
    typeof (cause as { message?: unknown }).message === 'string'
  ) {
    return (cause as { message: string }).message.slice(0, 240);
  }
  return cause.constructor?.name;
}

export type ArticleLike = {
  id: string;
  articleTitle?: string;
  codes?: string[];
  /** Canonical key from the producer row (`consolidatedArticles.articleKey`).
   *  When present, the worker uses it verbatim for backlog + sources writes
   *  instead of recomputing from title alone — the producer's key is
   *  category-aware and recomputing without category drifts. */
  articleKey?: string;
};

export async function generateSearchQueries(args: {
  article: ArticleLike;
  runId: string;
  stage: StageName;
  apiKeys: ProviderApiKeys;
}): Promise<string[]> {
  const resolved = resolveModel(QUERY_MODEL, args.apiKeys);
  const title = args.article.articleTitle ?? '(untitled)';
  const concepts = (args.article.codes ?? []).slice(0, 25).join('\n- ');
  const userMessage = `
Article title: ${title}

Concepts covered:
- ${concepts}

Produce 3 PubMed queries.
`.trim();

  const started = Date.now();
  try {
    const result = await generateText({
      model: resolved.sdkModel,
      system: DEFAULT_QUERY_GENERATION_PROMPT,
      prompt: userMessage,
      output: Output.array({ element: QuerySchema }),
      providerOptions: resolved.providerOptions,
      temperature: 0.6,
    });
    const queries = result.output.filter((q) => q.trim().length > 0);
    const durationMs = Date.now() - started;
    const usage = {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      reasoningTokens: result.usage?.reasoningTokens,
      cachedInputTokens: result.usage?.cachedInputTokens,
    };
    await logEvent({
      runId: args.runId,
      stage: args.stage,
      level: 'info',
      message: `Queries generated for ${title}: ${queries.length}`,
      metrics: {
        durationMs,
        ...usage,
        costUsd: estimateCostUsd(resolved.modelId, usage),
        model: resolved.modelId,
        provider: resolved.provider,
        reasoning: QUERY_MODEL.reasoning,
        completion: queries,
      },
    });
    return queries;
  } catch (e) {
    const objectError = noObjectError(e);
    if (objectError) {
      const recovered = recoverElementsFromText(objectError.text, QuerySchema);
      if (recovered && recovered.length > 0) {
        const queries = recovered.filter((q) => q.trim().length > 0);
        await logEvent({
          runId: args.runId,
          stage: args.stage,
          level: 'warn',
          message: `Recovered ${queries.length} queries from malformed JSON for ${title}`,
          metrics: {
            durationMs: Date.now() - started,
            model: resolved.modelId,
            provider: resolved.provider,
            jsonRetry: true,
            textLength: objectError.text?.length ?? 0,
            finishReason: objectError.finishReason,
            validationIssue: validationSummary(objectError),
            jsonShape: describeJsonShape(objectError.text),
          },
        });
        return queries;
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent({
      runId: args.runId,
      stage: args.stage,
      level: 'error',
      message: `Query generation failed for ${title}: ${msg}`,
      metrics: { durationMs: Date.now() - started, model: resolved.modelId },
    });
    throw e;
  }
}

export async function rankCandidates(args: {
  article: ArticleLike;
  candidates: PubmedCandidate[];
  runId: string;
  stage: StageName;
  apiKeys: ProviderApiKeys;
}): Promise<RankedSource[]> {
  if (args.candidates.length === 0) return [];
  const resolved = resolveModel(RANK_MODEL, args.apiKeys);
  const title = args.article.articleTitle ?? '(untitled)';
  const concepts = (args.article.codes ?? []).slice(0, 25).join('\n- ');
  // Strip authors lists down to first 3 + et al to keep the user
  // message compact; the ranker doesn't need the full author roster.
  const candidatePayload = args.candidates.map((c) => ({
    pmid: c.pmid,
    title: c.title,
    authors:
      c.authors.length > 3
        ? `${c.authors.slice(0, 3).join(', ')}, et al.`
        : c.authors.join(', '),
    journal: c.journal,
    year: c.year,
    doi: c.doi,
    url: c.url,
  }));
  const userMessage = `
Article title: ${title}

Concepts covered:
- ${concepts}

Candidate sources (JSON):
${JSON.stringify(candidatePayload, null, 2)}

Rank the candidates and return the top sources only.
`.trim();

  const started = Date.now();
  try {
    const result = await generateText({
      model: resolved.sdkModel,
      system: DEFAULT_RANK_CANDIDATES_PROMPT,
      prompt: userMessage,
      output: Output.array({ element: RankedSourceSchema }),
      providerOptions: resolved.providerOptions,
      temperature: 0.4,
    });
    const ranked = result.output
      .filter((r) => r.title && r.title.trim().length > 0)
      .sort((a, b) => a.rank - b.rank);
    const durationMs = Date.now() - started;
    const usage = {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      reasoningTokens: result.usage?.reasoningTokens,
      cachedInputTokens: result.usage?.cachedInputTokens,
    };
    await logEvent({
      runId: args.runId,
      stage: args.stage,
      level: 'info',
      message: `Ranked ${ranked.length} sources for ${title}`,
      metrics: {
        durationMs,
        ...usage,
        costUsd: estimateCostUsd(resolved.modelId, usage),
        model: resolved.modelId,
        provider: resolved.provider,
        reasoning: RANK_MODEL.reasoning,
        completion: ranked,
      },
    });
    return ranked;
  } catch (e) {
    const objectError = noObjectError(e);
    if (objectError) {
      const rawRows = recoverRawElementsFromText(objectError.text);
      const ranked = rawRows ? normalizeRankedSourceRows(rawRows) : [];
      if (ranked.length > 0) {
        await logEvent({
          runId: args.runId,
          stage: args.stage,
          level: 'warn',
          message: `Recovered ${ranked.length} ranked sources from malformed JSON for ${title}`,
          metrics: {
            durationMs: Date.now() - started,
            model: resolved.modelId,
            provider: resolved.provider,
            jsonRetry: true,
            textLength: objectError.text?.length ?? 0,
            finishReason: objectError.finishReason,
            validationIssue: validationSummary(objectError),
            jsonShape: describeJsonShape(objectError.text),
          },
        });
        return ranked;
      }
      await logEvent({
        runId: args.runId,
        stage: args.stage,
        level: 'error',
        message: `Ranking JSON recovery failed for ${title}`,
        metrics: {
          durationMs: Date.now() - started,
          model: resolved.modelId,
          provider: resolved.provider,
          jsonRetry: true,
          recoveredRows: 0,
          textLength: objectError.text?.length ?? 0,
          finishReason: objectError.finishReason,
          validationIssue: validationSummary(objectError),
          jsonShape: describeJsonShape(objectError.text),
        },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent({
      runId: args.runId,
      stage: args.stage,
      level: 'error',
      message: `Ranking failed for ${title}: ${msg}`,
      metrics: { durationMs: Date.now() - started, model: resolved.modelId },
    });
    throw e;
  }
}
