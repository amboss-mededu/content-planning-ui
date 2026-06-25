import { describe, expect, it } from 'vitest';
import { parsePipeCategory, topBlockOf, UNCATEGORIZED } from './curriculum-category';

describe('parsePipeCategory', () => {
  it('splits block and rest on the first pipe', () => {
    expect(parsePipeCategory('Bloque 1 | 1.1 Introducción')).toEqual({
      block: 'Bloque 1',
      rest: '1.1 Introducción',
    });
  });

  it('keeps deeper hierarchy in rest, splitting only on the first pipe', () => {
    expect(parsePipeCategory('Bloque 1 | 1.1 Intro | 1.1.1 Concepto')).toEqual({
      block: 'Bloque 1',
      rest: '1.1 Intro | 1.1.1 Concepto',
    });
  });

  it('treats a no-pipe string as the whole block', () => {
    expect(parsePipeCategory('Bloque 1')).toEqual({ block: 'Bloque 1', rest: '' });
  });

  it('trims whitespace around segments', () => {
    expect(parsePipeCategory('  Bloque 1  |  1.1 Intro  ')).toEqual({
      block: 'Bloque 1',
      rest: '1.1 Intro',
    });
  });

  it('drops empty segments from duplicate / trailing pipes', () => {
    expect(parsePipeCategory('Bloque 1 || 1.1 Intro |')).toEqual({
      block: 'Bloque 1',
      rest: '1.1 Intro',
    });
  });

  it('falls back to Uncategorized when the block segment is empty (leading pipe)', () => {
    expect(parsePipeCategory('| 1.1 Intro')).toEqual({
      block: UNCATEGORIZED,
      rest: '1.1 Intro',
    });
  });

  it('falls back to Uncategorized for empty / undefined / null', () => {
    expect(parsePipeCategory('')).toEqual({ block: UNCATEGORIZED, rest: '' });
    expect(parsePipeCategory('   ')).toEqual({ block: UNCATEGORIZED, rest: '' });
    expect(parsePipeCategory(undefined)).toEqual({ block: UNCATEGORIZED, rest: '' });
    expect(parsePipeCategory(null)).toEqual({ block: UNCATEGORIZED, rest: '' });
  });
});

describe('topBlockOf', () => {
  it('returns the block before the first pipe', () => {
    expect(topBlockOf('Bloque 2 | 2.3 Algo')).toBe('Bloque 2');
  });

  it('returns Uncategorized for empties', () => {
    expect(topBlockOf('')).toBe(UNCATEGORIZED);
    expect(topBlockOf(undefined)).toBe(UNCATEGORIZED);
  });
});
