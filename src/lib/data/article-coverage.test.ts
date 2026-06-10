import { describe, expect, it } from 'vitest';
import { computeOverallCoverageFromCodes } from './article-coverage';

describe('computeOverallCoverageFromCodes', () => {
  it('returns undefined for an empty array', () => {
    expect(computeOverallCoverageFromCodes([])).toBeUndefined();
  });

  it('returns undefined for non-array input', () => {
    expect(computeOverallCoverageFromCodes(undefined)).toBeUndefined();
    expect(computeOverallCoverageFromCodes(null)).toBeUndefined();
    expect(computeOverallCoverageFromCodes('nope')).toBeUndefined();
  });

  it('returns undefined when no code carries a numeric score', () => {
    expect(
      computeOverallCoverageFromCodes([
        { code: 'A' },
        { code: 'B', coverageScore: 'n/a' },
      ]),
    ).toBeUndefined();
  });

  it('averages numeric coverage scores', () => {
    expect(
      computeOverallCoverageFromCodes([
        { code: 'A', coverageScore: 2 },
        { code: 'B', coverageScore: 4 },
      ]),
    ).toBe(3);
  });

  it('parses string scores', () => {
    expect(
      computeOverallCoverageFromCodes([
        { code: 'A', coverageScore: '1' },
        { code: 'B', coverageScore: '2' },
      ]),
    ).toBe(1.5);
  });

  it('ignores unscored codes when averaging the scored ones', () => {
    expect(
      computeOverallCoverageFromCodes([
        { code: 'A', coverageScore: 3 },
        { code: 'B' },
        { code: 'C', coverageScore: 'x' },
      ]),
    ).toBe(3);
  });

  it('rounds to one decimal', () => {
    expect(
      computeOverallCoverageFromCodes([
        { code: 'A', coverageScore: 1 },
        { code: 'B', coverageScore: 1 },
        { code: 'C', coverageScore: 2 },
      ]),
    ).toBe(1.3);
  });
});
