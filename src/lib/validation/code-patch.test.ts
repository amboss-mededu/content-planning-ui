import { describe, expect, it } from 'vitest';
import { CodePatchBody } from './code-patch';

describe('CodePatchBody', () => {
  it('accepts a scalar-only body', () => {
    const r = CodePatchBody.safeParse({
      description: 'Acute MI',
      category: 'Cardiology',
      consolidationCategory: 'Myocardial infarction',
      source: 'ICD10',
    });
    expect(r.success).toBe(true);
  });

  it('accepts the coverage scalars', () => {
    const r = CodePatchBody.safeParse({
      isInAMBOSS: true,
      coverageLevel: 'attending',
      depthOfCoverage: 3,
      notes: 'n',
      gaps: 'g',
      improvements: 'i',
    });
    expect(r.success).toBe(true);
  });

  it('accepts the three suggestion arrays', () => {
    const r = CodePatchBody.safeParse({
      articlesWhereCoverageIs: [
        {
          articleTitle: 'A',
          articleId: 'a1',
          sections: [{ sectionTitle: 'S', sectionId: 's1' }],
        },
      ],
      existingArticleUpdates: [
        {
          articleTitle: 'B',
          sections: [{ sectionTitle: 'S2', exists: true, changes: 'c', importance: 4 }],
        },
      ],
      newArticlesNeeded: [{ articleTitle: 'C', importance: 5 }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts an empty array (clears a suggestion list)', () => {
    const r = CodePatchBody.safeParse({ newArticlesNeeded: [] });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown top-level key (strict)', () => {
    const r = CodePatchBody.safeParse({ description: 'x', mappedAt: 123 });
    expect(r.success).toBe(false);
  });

  it('rejects an out-of-enum coverage level', () => {
    const r = CodePatchBody.safeParse({ coverageLevel: 'expert' });
    expect(r.success).toBe(false);
  });

  it('rejects a negative depth of coverage', () => {
    const r = CodePatchBody.safeParse({ depthOfCoverage: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects a non-boolean isInAMBOSS', () => {
    const r = CodePatchBody.safeParse({ isInAMBOSS: 'yes' });
    expect(r.success).toBe(false);
  });

  it('strips unknown keys inside array items', () => {
    const r = CodePatchBody.safeParse({
      newArticlesNeeded: [{ articleTitle: 'C', importance: 5, bogus: 'drop me' }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.newArticlesNeeded?.[0]).toEqual({
        articleTitle: 'C',
        importance: 5,
      });
    }
  });

  it('accepts an empty object (route rejects no-op separately)', () => {
    const r = CodePatchBody.safeParse({});
    expect(r.success).toBe(true);
  });
});
