import { z } from 'zod';

const nullableString = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);
const nullableBoolean = z.preprocess((value) => {
  if (value === null || value === '') return undefined;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return value;
}, z.boolean().optional());
const nullableNumber = z.preprocess((value) => {
  if (value === null || value === '') return undefined;
  return value;
}, z.coerce.number().optional());

const ConsolidatedCodeSchema = z.object({
  code: z.string(),
  description: nullableString,
  previouslySuggestedArticleTitle: nullableString,
  previouslySuggestedArticleOrSectionTitle: nullableString,
  coverageScore: nullableNumber,
  importance: nullableNumber,
  index: z.union([z.number(), z.string()]).optional(),
});

const IgnoredArticleSchema = z.object({
  code: z.string(),
  description: nullableString,
  previouslySuggestedArticleTitle: nullableString,
  justification: nullableString,
  index: z.union([z.number(), z.string()]).optional(),
});

const IgnoredSectionSchema = z.object({
  code: z.string(),
  description: nullableString,
  previouslySuggestedSectionTitle: nullableString,
  exists: nullableBoolean,
  articleId: nullableString,
  justification: nullableString,
  index: z.union([z.number(), z.string()]).optional(),
});

export const ConsolidationOutputSchema = z.object({
  specialty: nullableString,
  category: z.string(),
  articles: z.array(
    z.object({
      articleTitle: z.string(),
      articleType: nullableString,
      exists: nullableBoolean,
      articleId: nullableString,
      codes: z.array(ConsolidatedCodeSchema),
      previousArticleTitleSuggestions: z.array(z.string()).optional().default([]),
      overallCoverage: nullableNumber,
      overallImportance: nullableNumber,
      justification: nullableString,
    }),
  ),
  includedArticleIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  ignoredArticles: z.array(IgnoredArticleSchema).optional().default([]),
  ignoredArticleIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  sections: z.array(
    z.object({
      articleTitle: z.string(),
      articleId: nullableString,
      articleType: nullableString,
      sectionUpdates: z.array(
        z.object({
          sectionName: z.string(),
          codes: z.array(ConsolidatedCodeSchema),
          previousArticleAndSectionTitleSuggestions: z
            .array(z.string())
            .optional()
            .default([]),
          exists: nullableBoolean,
          sectionId: nullableString,
          overallCoverage: nullableNumber,
          overallImportance: nullableNumber,
          justification: nullableString,
        }),
      ),
    }),
  ),
  includedSectionIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  ignoredSections: z.array(IgnoredSectionSchema).optional().default([]),
  ignoredSectionIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  totallyIgnoredIndexes: z
    .array(
      z.object({
        code: z.string(),
        index: z.union([z.number(), z.string()]).optional(),
        justification: nullableString,
      }),
    )
    .optional()
    .default([]),
});

const GenerationCodeSchema = z.object({
  code: z.string(),
  description: nullableString,
  previouslySuggestedArticleTitle: nullableString,
  previouslySuggestedArticleOrSectionTitle: nullableString,
  coverageScore: nullableNumber,
  importance: nullableNumber,
  index: z.union([z.number(), z.string()]).optional(),
});

// Used only for provider-side structured-output guidance. Keep the object
// names and required field structure visible to the provider, but leave local
// ConsolidationOutputSchema as the final source of truth.
export const ConsolidationOutputGenerationSchema = z.object({
  specialty: nullableString,
  category: z.string(),
  articles: z.array(
    z.object({
      articleTitle: z.string(),
      articleType: nullableString,
      exists: nullableBoolean,
      articleId: nullableString,
      codes: z.array(GenerationCodeSchema),
      previousArticleTitleSuggestions: z.array(z.string()).optional(),
      overallCoverage: nullableNumber,
      overallImportance: nullableNumber,
      justification: nullableString,
    }),
  ),
  includedArticleIndexes: z.array(z.union([z.number(), z.string()])).optional(),
  ignoredArticles: z
    .array(
      z.object({
        code: z.string(),
        description: nullableString,
        previouslySuggestedArticleTitle: nullableString,
        justification: nullableString,
        index: z.union([z.number(), z.string()]).optional(),
      }),
    )
    .optional(),
  ignoredArticleIndexes: z.array(z.union([z.number(), z.string()])).optional(),
  sections: z.array(
    z.object({
      articleTitle: z.string(),
      articleId: nullableString,
      articleType: nullableString,
      sectionUpdates: z.array(
        z.object({
          sectionName: z.string(),
          codes: z.array(GenerationCodeSchema),
          previousArticleAndSectionTitleSuggestions: z.array(z.string()).optional(),
          exists: nullableBoolean,
          sectionId: nullableString,
          overallCoverage: nullableNumber,
          overallImportance: nullableNumber,
          justification: nullableString,
        }),
      ),
    }),
  ),
  includedSectionIndexes: z.array(z.union([z.number(), z.string()])).optional(),
  ignoredSections: z
    .array(
      z.object({
        code: z.string(),
        description: nullableString,
        previouslySuggestedSectionTitle: nullableString,
        exists: nullableBoolean,
        articleId: nullableString,
        justification: nullableString,
        index: z.union([z.number(), z.string()]).optional(),
      }),
    )
    .optional(),
  ignoredSectionIndexes: z.array(z.union([z.number(), z.string()])).optional(),
  totallyIgnoredIndexes: z
    .array(
      z.object({
        code: z.string(),
        index: z.union([z.number(), z.string()]).optional(),
        justification: nullableString,
      }),
    )
    .optional(),
});

export type ConsolidationOutput = z.infer<typeof ConsolidationOutputSchema>;
export type ConsolidatedCode = z.infer<typeof ConsolidatedCodeSchema>;

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractFirstJsonObject(text: string): string | null {
  const input = stripJsonFence(text);
  if (input.startsWith('{')) return input;

  const start = input.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) return input.slice(start, i + 1);
  }
  return null;
}

export function parseConsolidationJsonText(text: string): unknown {
  const candidate = extractFirstJsonObject(text);
  if (!candidate) {
    throw new Error('No JSON object found in consolidation output');
  }
  return JSON.parse(candidate);
}

function topLevelKeys(raw: unknown): string[] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return Object.keys(raw);
}

function formatIssuePath(path: (string | number | symbol)[]): string {
  return path.length > 0 ? path.join('.') : 'output';
}

export class ConsolidationValidationError extends Error {
  readonly issuePath: string;
  readonly issueMessage: string;
  readonly topLevelKeys?: string[];

  constructor(expectedCategory: string, issue: z.core.$ZodIssue, raw: unknown) {
    const issuePath = formatIssuePath(issue.path);
    const keys = topLevelKeys(raw);
    const keySummary = keys ? `. Top-level keys: ${keys.join(', ') || '(none)'}` : '';
    super(
      `Invalid consolidation output for "${expectedCategory}": ${issuePath}: ${issue.message}${keySummary}`,
    );
    this.name = 'ConsolidationValidationError';
    this.issuePath = issuePath;
    this.issueMessage = issue.message;
    this.topLevelKeys = keys;
  }
}

export function validateConsolidationOutput(
  raw: unknown,
  expectedCategory: string,
): ConsolidationOutput {
  const parsed = ConsolidationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConsolidationValidationError(expectedCategory, parsed.error.issues[0], raw);
  }

  if (parsed.data.category !== expectedCategory) {
    throw new Error(
      `Consolidation output category mismatch: expected "${expectedCategory}", got "${parsed.data.category}"`,
    );
  }

  return parsed.data;
}
