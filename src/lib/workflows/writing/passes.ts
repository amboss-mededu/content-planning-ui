/**
 * Per-pass Gemini calls for the article-writing pipeline.
 *
 * Each pass is a plain `generateText` invocation: system prompt fixed
 * (from `prompts.ts`), user message constructed from the previous
 * pass's output plus a small per-pass header. The orchestrator in
 * `write-article.ts` is responsible for sequencing + persistence.
 *
 * Source PDFs:
 *   Editors trigger an upload to Gemini Files API for an article's
 *   sources via `/api/workflows/upload-article-pdfs`. When a source row
 *   has a `uri` set, the primary + proofreader passes attach it as a
 *   FilePart (the AI SDK serializes `data: new URL(uri)` to Gemini's
 *   `fileData` wire format). Sources without a URI still appear in the
 *   text-metadata block so the model knows what's referenced.
 *
 * QC files (proofreader):
 *   `references_table.tsv` / `facts_table.tsv` come from a separate n8n
 *   "QC and Hallucination Check" HTTP node that is not yet ported. The
 *   orchestrator skips this pass by default (`skipProofreader: true`)
 *   until QC is wired — see `write-article.ts`.
 */

import { generateText, type ModelMessage } from 'ai';
import type { ArticleSourceRecord } from '@/lib/pb/types';
import { logEvent } from '../lib/events';
import { type ModelSpec, type ProviderApiKeys, resolveModel } from '../lib/llm';
import { estimateCostUsd } from '../lib/pricing';
import { WRITING_PASS_PROMPTS, type WritingPass } from './prompts';

export type PassInput = {
  /** The articleWritingRuns PB row id — used for log scoping. */
  runId: string;
  specialtySlug: string;
  articleRecordId: string;
  articleTitle: string;
  language: string;
  articleLength: string;
  useTextBubbles: boolean;
  sources: ArticleSourceRecord[];
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
  /** Output of the previous pass (empty for `primary`). */
  previousOutput: string;
};

export type PassResult = {
  output: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  };
  costUsd: number | null;
  modelId: string;
};

// --- per-pass user-message builders ----------------------------------------

function buildSourceMetadataJson(sources: ArticleSourceRecord[]): string {
  return JSON.stringify(
    sources.map((s, i) => ({
      ribosomId: s.ribosomId ?? null,
      priority: s.priority ?? i + 1,
      title: s.title,
      journal: s.journal ?? '',
      doi: s.doi ?? '',
      url: s.url ?? '',
      originalFilename: s.originalFilename ?? '',
      // geminiFileUri is what the n8n flow used to pass PDFs as
      // `fileData` parts. Echoed back to the model as text until the
      // file-upload step is wired (see TODO at top of file).
      geminiFileUri: s.uri ?? '',
      mimeType: s.mimeType ?? 'application/pdf',
      sourceType: s.sourceType ?? '',
    })),
    null,
    2,
  );
}

function buildPrimaryUserMessage(input: PassInput): string {
  // Mirrors the n8n "Create Primary Editor Request" code node. Source
  // PDFs that have been uploaded to Gemini Files API are attached as
  // `fileData` parts on the message — see `buildUserMessageParts`.
  return `
Generate a full, concise, and clinically relevant AMBOSS-style article on the following topic:

  **Disease Topic**
  ${input.articleTitle}

  **Language**
  ${input.language}

  **Article Length**
  ${input.articleLength}

  **Use Text Bubbles**
  ${input.useTextBubbles}

  **Sources Ordered By Priority**
  ${buildSourceMetadataJson(input.sources)}
`.trim();
}

function buildSecondaryUserMessage(prev: string): string {
  return `
Create the secondary edit:

**Article Draft**
${prev}
`.trim();
}

function buildProofreaderUserMessage(input: PassInput): string {
  // n8n appends QC tables that come from a separate "QC and
  // Hallucination Check" HTTP node — not yet ported. Stubbed empty.
  return `
Proofread the article:
${input.previousOutput}

QC Files:
References table
(empty — QC pass not yet wired)

Facts table
(empty — QC pass not yet wired)

Facts table expanded
(empty — QC pass not yet wired)

**Sources Ordered By Priority**
${buildSourceMetadataJson(input.sources)}
`.trim();
}

function buildStyleUserMessage(prev: string): string {
  return `
Style the following article:
${prev}
`.trim();
}

function buildHtmlUserMessage(prev: string): string {
  return `
Generate HTML and add a summary section for:
${prev}
`.trim();
}

function buildCopyUserMessage(prev: string): string {
  return `
Style the article.
${prev}
`.trim();
}

function buildUserMessage(pass: WritingPass, input: PassInput): string {
  switch (pass) {
    case 'primary':
      return buildPrimaryUserMessage(input);
    case 'secondary':
      return buildSecondaryUserMessage(input.previousOutput);
    case 'proofreader':
      return buildProofreaderUserMessage(input);
    case 'style':
      return buildStyleUserMessage(input.previousOutput);
    case 'html':
      return buildHtmlUserMessage(input.previousOutput);
    case 'copy':
      return buildCopyUserMessage(input.previousOutput);
  }
}

/**
 * Build the AI SDK `messages` array. For passes that benefit from the
 * source PDFs (primary, proofreader), uploaded sources are attached as
 * FilePart entries so Gemini sees the document bytes directly. Sources
 * without a URI are referenced only via the text-metadata block — we
 * don't fall back to inline base64 (that would balloon prompt size).
 */
function buildUserMessageParts(pass: WritingPass, input: PassInput): ModelMessage[] {
  const text = buildUserMessage(pass, input);
  const includeFiles = pass === 'primary' || pass === 'proofreader';
  if (!includeFiles) return [{ role: 'user', content: text }];

  const fileParts = input.sources
    .filter((s) => s.uri)
    .map((s) => ({
      type: 'file' as const,
      data: new URL(s.uri as string),
      mediaType: s.mimeType || 'application/pdf',
      filename: s.originalFilename || `${s.title}.pdf`,
    }));

  if (fileParts.length === 0) return [{ role: 'user', content: text }];

  return [
    {
      role: 'user',
      content: [{ type: 'text', text }, ...fileParts],
    },
  ];
}

// --- entry point -----------------------------------------------------------

export async function runWritingPass(
  pass: WritingPass,
  input: PassInput,
): Promise<PassResult> {
  const system = WRITING_PASS_PROMPTS[pass];
  const messages = buildUserMessageParts(pass, input);
  const resolved = resolveModel(input.model, input.apiKeys);
  const attachedFiles = (() => {
    const first = messages[0]?.content;
    if (typeof first === 'string') return 0;
    return first.filter((p) => p.type === 'file').length;
  })();

  await logEvent({
    runId: input.runId,
    // Pass-scoped log stage — pipeline events table is shared with the
    // specialty-wide pipeline, but the runId differs so they don't mix.
    stage: 'write_article',
    level: 'info',
    message: `[${pass}] starting${attachedFiles > 0 ? ` · ${attachedFiles} PDF(s) attached` : ''}`,
    metrics: {
      pass,
      model: resolved.modelId,
      provider: resolved.provider,
      reasoning: input.model.reasoning,
      attachedFiles,
    },
  });

  const started = Date.now();
  const result = await generateText({
    model: resolved.sdkModel,
    system,
    messages,
    providerOptions: resolved.providerOptions,
    temperature: pass === 'proofreader' ? 0 : 1,
  });

  const durationMs = Date.now() - started;
  const usage = {
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    reasoningTokens: result.usage?.reasoningTokens,
  };
  const costUsd = estimateCostUsd(resolved.modelId, {
    ...usage,
    cachedInputTokens: result.usage?.cachedInputTokens,
  });

  await logEvent({
    runId: input.runId,
    stage: 'write_article',
    level: 'info',
    message: `[${pass}] done in ${durationMs}ms · ${result.text.length} chars`,
    metrics: {
      pass,
      durationMs,
      ...usage,
      costUsd,
      model: resolved.modelId,
    },
  });

  return {
    output: result.text,
    usage,
    costUsd,
    modelId: resolved.modelId,
  };
}
