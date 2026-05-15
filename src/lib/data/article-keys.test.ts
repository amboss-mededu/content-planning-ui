import { describe, expect, it } from 'vitest';
import {
  computeArticleKey,
  computeSectionKey,
  EMPTY_KEY,
  normalizeForKey,
} from './article-keys';

describe('normalizeForKey', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(normalizeForKey('Heart Failure with Preserved EF')).toBe(
      'heart-failure-with-preserved-ef',
    );
  });

  it('strips diacritics so "café" matches "cafe"', () => {
    expect(normalizeForKey('café au lait')).toBe(normalizeForKey('cafe au lait'));
  });

  it('absorbs punctuation drift from LLM rephrasing', () => {
    expect(normalizeForKey('Heart failure (HFpEF)')).toBe(
      normalizeForKey('Heart failure - HFpEF'),
    );
    expect(normalizeForKey('Heart failure: chronic')).toBe(
      normalizeForKey('Heart failure - chronic'),
    );
  });

  it('is idempotent', () => {
    const once = normalizeForKey('Heart failure (HFpEF)');
    expect(normalizeForKey(once)).toBe(once);
  });

  it('does not merge semantically different titles', () => {
    expect(normalizeForKey('Acute pancreatitis')).not.toBe(
      normalizeForKey('Chronic pancreatitis'),
    );
  });
});

describe('computeArticleKey', () => {
  it('prefers articleId (CMS) when present', () => {
    expect(
      computeArticleKey({
        specialtySlug: 'cardiology',
        articleTitle: 'Heart failure',
        articleId: 'cms-abc-123',
      }),
    ).toBe('upd::cms-abc-123');
  });

  it('falls back to slug + normalized title for new articles', () => {
    expect(
      computeArticleKey({
        specialtySlug: 'cardiology',
        articleTitle: 'Heart Failure with Preserved EF',
      }),
    ).toBe('new::cardiology::heart-failure-with-preserved-ef');
  });

  it('returns EMPTY_KEY when neither field is usable', () => {
    expect(computeArticleKey({ specialtySlug: 'cardiology', articleTitle: '   ' })).toBe(
      EMPTY_KEY,
    );
    expect(computeArticleKey({ specialtySlug: 'cardiology' })).toBe(EMPTY_KEY);
  });

  it('is stable across title rephrasing (within normalization rules)', () => {
    const a = computeArticleKey({
      specialtySlug: 'card',
      articleTitle: 'Heart failure (HFpEF)',
    });
    const b = computeArticleKey({
      specialtySlug: 'card',
      articleTitle: 'Heart failure HFpEF',
    });
    expect(a).toBe(b);
  });

  it('is specialty-scoped so two specialties can share a title', () => {
    const cardio = computeArticleKey({
      specialtySlug: 'cardiology',
      articleTitle: 'Hypertension',
    });
    const renal = computeArticleKey({
      specialtySlug: 'nephrology',
      articleTitle: 'Hypertension',
    });
    expect(cardio).not.toBe(renal);
  });
});

describe('computeSectionKey', () => {
  it('prefers (articleId, sectionId) when both present', () => {
    expect(
      computeSectionKey({
        specialtySlug: 'cardiology',
        articleId: 'a-1',
        sectionId: 's-1',
        articleTitle: 'whatever',
        sectionName: 'whatever',
      }),
    ).toBe('sec-upd::a-1::s-1');
  });

  it('falls back to slug + titles for new sections', () => {
    expect(
      computeSectionKey({
        specialtySlug: 'cardiology',
        articleTitle: 'Heart failure',
        sectionName: 'Clinical features',
      }),
    ).toBe('sec::cardiology::heart-failure::clinical-features');
  });

  it('does not promote partial CMS info (article without section)', () => {
    // articleId alone is not enough — must have both ids for the CMS path.
    expect(
      computeSectionKey({
        specialtySlug: 'cardiology',
        articleId: 'a-1',
        articleTitle: 'Heart failure',
        sectionName: 'Definition',
      }),
    ).toBe('sec::cardiology::heart-failure::definition');
  });

  it('returns EMPTY_KEY when nothing identifies the section', () => {
    expect(computeSectionKey({ specialtySlug: 'cardiology' })).toBe(EMPTY_KEY);
    expect(computeSectionKey({ specialtySlug: 'cardiology', articleTitle: 'X' })).toBe(
      EMPTY_KEY,
    );
  });
});
