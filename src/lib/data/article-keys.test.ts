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

  it('same title in two categories yields distinct keys', () => {
    const cardiac = computeArticleKey({
      specialtySlug: 'anesthesiology',
      articleTitle: 'Neuroanesthesia',
      category: 'Cardiac',
    });
    const vascular = computeArticleKey({
      specialtySlug: 'anesthesiology',
      articleTitle: 'Neuroanesthesia',
      category: 'Vascular',
    });
    expect(cardiac).not.toBe(vascular);
    expect(cardiac).toBe('new::anesthesiology::cardiac::neuroanesthesia');
  });

  it('same title same category yields the same key', () => {
    const a = computeArticleKey({
      specialtySlug: 'anesthesiology',
      articleTitle: 'Neuroanesthesia',
      category: 'Cardiac',
    });
    const b = computeArticleKey({
      specialtySlug: 'anesthesiology',
      articleTitle: 'Neuroanesthesia',
      category: 'Cardiac',
    });
    expect(a).toBe(b);
  });

  it('category-less rows fall back to the pre-category formula', () => {
    expect(
      computeArticleKey({
        specialtySlug: 'cardiology',
        articleTitle: 'Hypertension',
      }),
    ).toBe('new::cardiology::hypertension');
  });

  it('articleId wins even when category is set', () => {
    expect(
      computeArticleKey({
        specialtySlug: 'cardiology',
        articleTitle: 'Heart failure',
        articleId: 'cms-1',
        category: 'Cardiac',
      }),
    ).toBe('upd::cms-1');
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

  it('same section in two categories yields distinct keys', () => {
    const cardiac = computeSectionKey({
      specialtySlug: 'anesthesiology',
      articleTitle: 'Neuroanesthesia',
      sectionName: 'Definition',
      category: 'Cardiac',
    });
    const vascular = computeSectionKey({
      specialtySlug: 'anesthesiology',
      articleTitle: 'Neuroanesthesia',
      sectionName: 'Definition',
      category: 'Vascular',
    });
    expect(cardiac).not.toBe(vascular);
  });

  it('same CMS section in two categories yields distinct sec-upd keys', () => {
    // Real-world repro: "The leg, ankle, and foot / Bones and joints"
    // appears under both Anatomy and Regional Anesthesia in the
    // anesthesiology fixture. Without category in the sec-upd key,
    // approving one category's row flips both.
    const anatomy = computeSectionKey({
      specialtySlug: 'anesthesiology',
      articleId: 'p60LNS',
      sectionId: 's-bones-joints',
      category: 'I.A.1 Anatomy',
    });
    const regional = computeSectionKey({
      specialtySlug: 'anesthesiology',
      articleId: 'p60LNS',
      sectionId: 's-bones-joints',
      category: 'II.B.1 Regional Anesthesia',
    });
    expect(anatomy).not.toBe(regional);
  });
});
