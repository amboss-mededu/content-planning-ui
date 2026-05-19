import type { CodeCategoryRecord } from '@/lib/pb/types';

type DecisionArrays = Pick<
  CodeCategoryRecord,
  | 'includedArticleCodes'
  | 'excludedArticleCodes'
  | 'includedSectionCodes'
  | 'excludedSectionCodes'
  | 'totallyIgnoredCodes'
>;

export type DecisionPatch = {
  includedArticleCodes: string[];
  numIncludedArticleCodes: number;
  excludedArticleCodes: string[];
  numExcludedArticleCodes: number;
  includedSectionCodes: string[];
  numIncludedSectionCodes: number;
  excludedSectionCodes: string[];
  numExcludedSectionCodes: number;
  totallyIgnoredCodes: string[];
  numTotallyIgnoredCodes: number;
  numIncludedCodes: number;
  isConsolidated: boolean;
};

export function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

export function resetCodeCategoryDecisionArrays(
  row: DecisionArrays,
  codesToRemove: Set<string>,
): DecisionPatch {
  const includedArticleCodes = stringArray(row.includedArticleCodes).filter(
    (code) => !codesToRemove.has(code),
  );
  const excludedArticleCodes = stringArray(row.excludedArticleCodes).filter(
    (code) => !codesToRemove.has(code),
  );
  const includedSectionCodes = stringArray(row.includedSectionCodes).filter(
    (code) => !codesToRemove.has(code),
  );
  const excludedSectionCodes = stringArray(row.excludedSectionCodes).filter(
    (code) => !codesToRemove.has(code),
  );
  const totallyIgnoredCodes = stringArray(row.totallyIgnoredCodes).filter(
    (code) => !codesToRemove.has(code),
  );

  return {
    includedArticleCodes,
    numIncludedArticleCodes: includedArticleCodes.length,
    excludedArticleCodes,
    numExcludedArticleCodes: excludedArticleCodes.length,
    includedSectionCodes,
    numIncludedSectionCodes: includedSectionCodes.length,
    excludedSectionCodes,
    numExcludedSectionCodes: excludedSectionCodes.length,
    totallyIgnoredCodes,
    numTotallyIgnoredCodes: totallyIgnoredCodes.length,
    numIncludedCodes: includedArticleCodes.length + includedSectionCodes.length,
    isConsolidated: false,
  };
}

export function hasDecisionChange(row: DecisionArrays, patch: DecisionPatch): boolean {
  return (
    stringArray(row.includedArticleCodes).length !== patch.includedArticleCodes.length ||
    stringArray(row.excludedArticleCodes).length !== patch.excludedArticleCodes.length ||
    stringArray(row.includedSectionCodes).length !== patch.includedSectionCodes.length ||
    stringArray(row.excludedSectionCodes).length !== patch.excludedSectionCodes.length ||
    stringArray(row.totallyIgnoredCodes).length !== patch.totallyIgnoredCodes.length
  );
}
