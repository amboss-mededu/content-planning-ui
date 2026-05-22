import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { recoverElementsFromText } from './json-recovery';
import { normalizeRankedSourceRows } from './ranked-source-normalization';

describe('recoverElementsFromText', () => {
  const elementSchema = z.object({
    title: z.string(),
    rank: z.number().int(),
  });

  it('recovers elements from an Output.array-shaped object', () => {
    expect(
      recoverElementsFromText(
        '{"elements":[{"title":"Guideline","rank":1}]}',
        elementSchema,
      ),
    ).toEqual([{ title: 'Guideline', rank: 1 }]);
  });

  it('recovers elements from a bare array', () => {
    expect(
      recoverElementsFromText('[{"title":"Review","rank":2}]', elementSchema),
    ).toEqual([{ title: 'Review', rank: 2 }]);
  });

  it('recovers elements from fenced JSON', () => {
    expect(
      recoverElementsFromText(
        '```json\n{"elements":[{"title":"Meta-analysis","rank":3}]}\n```',
        elementSchema,
      ),
    ).toEqual([{ title: 'Meta-analysis', rank: 3 }]);
  });

  it('returns null for invalid JSON', () => {
    expect(recoverElementsFromText('not json', elementSchema)).toBeNull();
  });
});

describe('normalizeRankedSourceRows', () => {
  it('accepts nullable optional fields and string ranks', () => {
    expect(
      normalizeRankedSourceRows([
        {
          title: 'Guideline',
          doi: null,
          url: ' https://example.test ',
          sourceType: 'clinical guideline',
          rank: '2',
        },
      ]),
    ).toEqual([
      {
        title: 'Guideline',
        doi: undefined,
        url: 'https://example.test',
        journal: undefined,
        journalNlm: undefined,
        sourceType: 'guideline',
        predatoryJournalRisk: undefined,
        rank: 2,
        subtopics: undefined,
        llmSummary: undefined,
        justification: undefined,
        superseded: undefined,
      },
    ]);
  });

  it('assigns missing ranks by output order and drops rows without titles', () => {
    expect(
      normalizeRankedSourceRows([
        { title: 'First' },
        { title: '' },
        { title: 'Third', rank: 3 },
      ]).map((r) => ({ title: r.title, rank: r.rank })),
    ).toEqual([
      { title: 'First', rank: 1 },
      { title: 'Third', rank: 3 },
    ]);
  });

  it('maps source type aliases and unknown source types to other', () => {
    expect(
      normalizeRankedSourceRows([
        { title: 'Meta', sourceType: 'meta-analysis', rank: 1 },
        { title: 'Mystery', sourceType: 'preprint', rank: 2 },
      ]).map((r) => r.sourceType),
    ).toEqual(['meta_analysis', 'other']);
  });
});
