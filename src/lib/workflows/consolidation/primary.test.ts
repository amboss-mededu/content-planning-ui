import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logEvent } from '../lib/events';
import type { ModelSpec, ResolvedModel } from '../lib/llm';
import { generatePrimaryConsolidationOutput } from './primary-model-call';
import {
  parseConsolidationJsonText,
  validateConsolidationOutput,
} from './primary-output';
import { buildCategoryConsolidationPrompt } from './prompts';

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

vi.mock('../lib/events', () => ({
  logEvent: vi.fn(async () => undefined),
}));

const validOutput = {
  specialty: 'Anesthesiology',
  category: 'Airway',
  articles: [
    {
      articleTitle: 'Airway management',
      articleType: 'clinical',
      exists: false,
      articleId: null,
      codes: [
        {
          code: 'A001',
          description: 'Basic airway management',
          previouslySuggestedArticleTitle: 'Airway management',
          previouslySuggestedArticleOrSectionTitle: 'Airway management',
          coverageScore: 4,
          importance: 5,
          index: 1,
        },
      ],
      previousArticleTitleSuggestions: ['Airway management'],
      overallCoverage: 4,
      overallImportance: 5,
      justification: 'Important standalone coverage.',
    },
  ],
  includedArticleIndexes: [1],
  ignoredArticles: [],
  ignoredArticleIndexes: [],
  sections: [
    {
      articleTitle: 'Anesthesia overview',
      articleId: 'article-1',
      articleType: 'clinical',
      sectionUpdates: [
        {
          sectionName: 'Airway',
          codes: [
            {
              code: 'A002',
              description: 'Advanced airway management',
              previouslySuggestedArticleTitle: 'Anesthesia overview',
              previouslySuggestedArticleOrSectionTitle: 'Anesthesia overview - Airway',
              coverageScore: 3,
              importance: 4,
              index: 2,
            },
          ],
          previousArticleAndSectionTitleSuggestions: ['Anesthesia overview - Airway'],
          exists: true,
          sectionId: 'section-1',
          overallCoverage: 3,
          overallImportance: 4,
          justification: 'Fits the existing article.',
        },
      ],
    },
  ],
  includedSectionIndexes: [2],
  ignoredSections: [],
  ignoredSectionIndexes: [],
  totallyIgnoredIndexes: [],
};

const model: ModelSpec = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-7',
  reasoning: 'auto',
};

const resolved = {
  sdkModel: {} as ResolvedModel['sdkModel'],
  providerOptions: { anthropic: { thinking: { type: 'adaptive' } } },
  modelId: 'claude-sonnet-4-7',
  provider: 'anthropic',
} satisfies ResolvedModel;

function llmResult(output: unknown, text = JSON.stringify(output)) {
  return {
    output,
    text,
    usage: {},
    finishReason: 'stop',
  };
}

async function generateForTest(category = 'Airway') {
  return generatePrimaryConsolidationOutput({
    runId: 'run-1',
    category,
    prompt: 'prompt',
    resolved,
    model,
  });
}

beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(logEvent).mockClear();
});

describe('buildCategoryConsolidationPrompt', () => {
  it('includes the required top-level and nested JSON keys', () => {
    const prompt = buildCategoryConsolidationPrompt({
      specialty: 'Anesthesiology',
      category: 'Airway',
      language: 'English',
      region: 'US',
      articleTitles: ['Anesthesia overview'],
      codes: [],
    });

    for (const key of [
      '"articles"',
      '"ignoredArticles"',
      '"sections"',
      '"ignoredSections"',
      '"includedArticleIndexes"',
      '"ignoredArticleIndexes"',
      '"includedSectionIndexes"',
      '"ignoredSectionIndexes"',
      '"totallyIgnoredIndexes"',
      '"articleTitle"',
      '"codes"',
      '"sectionUpdates"',
      '"previousArticleAndSectionTitleSuggestions"',
    ]) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain('Return a bare JSON object');
    expect(prompt).toContain('Use empty arrays when there are no items');
  });
});

describe('validateConsolidationOutput', () => {
  it('accepts valid JSON output', () => {
    expect(validateConsolidationOutput(validOutput, 'Airway')).toMatchObject({
      category: 'Airway',
      articles: [{ articleTitle: 'Airway management' }],
      sections: [{ articleTitle: 'Anesthesia overview' }],
    });
  });

  it('recovers fenced JSON output', () => {
    const parsed = parseConsolidationJsonText(
      `\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``,
    );

    expect(validateConsolidationOutput(parsed, 'Airway')).toMatchObject({
      category: 'Airway',
    });
  });

  it('recovers JSON surrounded by extra text', () => {
    const parsed = parseConsolidationJsonText(
      `Here is the consolidation result:\n${JSON.stringify(validOutput)}\nDone.`,
    );

    expect(validateConsolidationOutput(parsed, 'Airway')).toMatchObject({
      category: 'Airway',
    });
  });

  it('throws when malformed text cannot be recovered as JSON', () => {
    expect(() =>
      parseConsolidationJsonText('```json\n{"category": "Airway"\n```'),
    ).toThrow(SyntaxError);
  });

  it('throws a clear error for malformed output', () => {
    expect(() =>
      validateConsolidationOutput(
        {
          category: 'Airway',
          sections: [],
        },
        'Airway',
      ),
    ).toThrow(
      /Invalid consolidation output for "Airway": articles: .*Top-level keys: category, sections/,
    );
  });

  it('keeps semicolon-containing category names intact in diagnostics', () => {
    expect(() =>
      validateConsolidationOutput(
        {
          category: 'IV Fluids; Electrolytes',
          sections: [],
        },
        'IV Fluids; Electrolytes',
      ),
    ).toThrow(/Invalid consolidation output for "IV Fluids; Electrolytes": articles:/);
  });

  it('reports a missing nested sectionUpdates path', () => {
    expect(() =>
      validateConsolidationOutput(
        {
          ...validOutput,
          sections: [
            {
              articleTitle: 'Anesthesia overview',
              articleId: 'article-1',
              articleType: 'clinical',
            },
          ],
        },
        'Airway',
      ),
    ).toThrow(/sections.0.sectionUpdates:/);
  });

  it('reports wrapper-object top-level keys', () => {
    expect(() => validateConsolidationOutput({ output: validOutput }, 'Airway')).toThrow(
      /Top-level keys: output/,
    );
  });

  it('throws when the output category does not match the requested category', () => {
    expect(() =>
      validateConsolidationOutput(
        {
          ...validOutput,
          category: 'Pain',
        },
        'Airway',
      ),
    ).toThrow('Consolidation output category mismatch: expected "Airway", got "Pain"');
  });
});

describe('generatePrimaryConsolidationOutput', () => {
  it('returns schema-valid object output', async () => {
    vi.mocked(generateText).mockResolvedValueOnce(llmResult(validOutput) as never);

    await expect(generateForTest()).resolves.toMatchObject({
      output: { category: 'Airway' },
    });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.not.objectContaining({ temperature: expect.anything() }),
    );
  });

  it('recovers when result.output is invalid but result.text contains valid JSON', async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      llmResult({ category: 'Airway' }, JSON.stringify(validOutput)) as never,
    );

    await expect(generateForTest()).resolves.toMatchObject({
      output: { category: 'Airway' },
    });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: expect.stringContaining('Recovered schema-valid JSON'),
      }),
    );
  });

  it('stamps the expected category before validating model-call output', async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      llmResult({ ...validOutput, category: 'Shortened category' }) as never,
    );

    await expect(generateForTest()).resolves.toMatchObject({
      output: { category: 'Airway' },
    });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('retries once and succeeds when malformed output becomes valid', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(llmResult({ category: 'Airway' }, '{bad json') as never)
      .mockResolvedValueOnce(llmResult(validOutput) as never);

    await expect(generateForTest()).resolves.toMatchObject({
      output: { category: 'Airway' },
    });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateText).mock.calls[1][0].prompt).toContain(
      'Return exactly one valid JSON object',
    );
  });

  it('retries once and fails with provider/model and a concise validation issue', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(llmResult({ category: 'Airway' }, '{bad json') as never)
      .mockResolvedValueOnce(llmResult({ category: 'Airway' }, '{bad json') as never);

    await expect(generateForTest()).rejects.toThrow(
      /Invalid consolidation JSON for "Airway" using anthropic\/claude-sonnet-4-7 .*returned JSON that failed validation; first issue: Invalid consolidation output for "Airway":/,
    );
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        metrics: expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-sonnet-4-7',
          failureKind: 'schema_validation_failed',
          validationIssuePath: 'articles',
          validationIssueMessage: expect.any(String),
          topLevelKeys: ['category'],
          validationIssue: expect.stringContaining(
            'Invalid consolidation output for "Airway"',
          ),
        }),
      }),
    );
  });

  it('does not truncate validation diagnostics when the category contains semicolons', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(
        llmResult(
          { category: 'IV Fluids; Electrolytes' },
          JSON.stringify({ category: 'IV Fluids; Electrolytes' }),
        ) as never,
      )
      .mockResolvedValueOnce(
        llmResult(
          { category: 'IV Fluids; Electrolytes' },
          JSON.stringify({ category: 'IV Fluids; Electrolytes' }),
        ) as never,
      );

    await expect(generateForTest('IV Fluids; Electrolytes')).rejects.toThrow(
      /Invalid consolidation JSON for "IV Fluids; Electrolytes" using anthropic\/claude-sonnet-4-7 .*first issue: Invalid consolidation output for "IV Fluids; Electrolytes": articles:/,
    );
  });
});
