export type ConsolidationMappingSummary = {
  mapped: number;
  total: number;
  ready: boolean;
};

export type ConsolidationBucketCode = {
  code?: string;
  consolidationCategory?: string | null;
  mappedAt?: number | null;
};

export type ConsolidationOutputRow = {
  category?: string | null;
  codes?: unknown[] | null;
};

export type ConsolidationDecisionRow = {
  excludedArticleCodes?: unknown;
  excludedSectionCodes?: unknown;
  totallyIgnoredCodes?: unknown;
};

export type BucketCodeStatus = 'included' | 'excluded' | 'ignored' | 'orphan' | 'pending';

export type DerivedBucketStats = {
  hasConsolidatedOutput: boolean;
  numIncludedCodes: number | null;
  numExcludedCodes: number | null;
  numTotallyIgnoredCodes: number | null;
  numOrphanCodes: number | null;
  hasAnyStatusInfo: boolean;
  statusByCode: Map<string, BucketCodeStatus>;
};

export function deriveConsolidationMappingByCategory(
  codes: ConsolidationBucketCode[],
): Record<string, ConsolidationMappingSummary> {
  const out: Record<string, ConsolidationMappingSummary> = {};
  for (const code of codes) {
    const cat = code.consolidationCategory?.trim();
    if (!cat) continue;
    const entry = out[cat] ?? { mapped: 0, total: 0, ready: false };
    entry.total += 1;
    if ((code.mappedAt ?? 0) > 0) entry.mapped += 1;
    out[cat] = entry;
  }
  for (const cat of Object.keys(out)) {
    const entry = out[cat];
    entry.ready = entry.total > 0 && entry.mapped === entry.total;
  }
  return out;
}

export function filterCodesByConsolidationCategories<T extends ConsolidationBucketCode>(
  codes: T[],
  consolidationCategories?: string[] | null,
): T[] {
  const set = consolidationCategories?.length
    ? new Set(consolidationCategories.map((category) => category.trim()))
    : null;
  return codes.filter((code) => {
    const cat = code.consolidationCategory?.trim();
    if (!cat) return false;
    return set ? set.has(cat) : true;
  });
}

export function groupByConsolidationCategory<T extends ConsolidationBucketCode>(
  codes: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const code of codes) {
    const cat = code.consolidationCategory?.trim() || '(unbucketed)';
    const bucket = groups.get(cat) ?? [];
    bucket.push(code);
    groups.set(cat, bucket);
  }
  return groups;
}

export function deriveOutputCategories(rows: ConsolidationOutputRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const category = row.category?.trim();
    if (category) out.add(category);
  }
  return out;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function extractOutputCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (
      item &&
      typeof item === 'object' &&
      typeof (item as { code?: unknown }).code === 'string'
    ) {
      out.push((item as { code: string }).code);
    }
  }
  return out;
}

export function deriveBucketStats({
  bucket,
  codes,
  outputRows,
  decisionRows,
}: {
  bucket: string;
  codes: Iterable<string>;
  outputRows: ConsolidationOutputRow[];
  decisionRows?: ConsolidationDecisionRow[];
}): DerivedBucketStats {
  const bucketCodes = new Set(codes);
  const matchingOutputRows = outputRows.filter((row) => row.category?.trim() === bucket);
  const hasConsolidatedOutput = matchingOutputRows.length > 0;
  const statusByCode = new Map<string, BucketCodeStatus>();

  if (!hasConsolidatedOutput) {
    for (const code of bucketCodes) statusByCode.set(code, 'pending');
    return {
      hasConsolidatedOutput: false,
      numIncludedCodes: null,
      numExcludedCodes: null,
      numTotallyIgnoredCodes: null,
      numOrphanCodes: null,
      hasAnyStatusInfo: false,
      statusByCode,
    };
  }

  const included = new Set<string>();
  for (const row of matchingOutputRows) {
    for (const code of extractOutputCodes(row.codes)) {
      if (bucketCodes.has(code)) included.add(code);
    }
  }

  const excluded = new Set<string>();
  const ignored = new Set<string>();
  for (const row of decisionRows ?? []) {
    for (const code of extractStringArray(row.excludedArticleCodes)) {
      if (bucketCodes.has(code) && !included.has(code)) excluded.add(code);
    }
    for (const code of extractStringArray(row.excludedSectionCodes)) {
      if (bucketCodes.has(code) && !included.has(code)) excluded.add(code);
    }
  }
  for (const row of decisionRows ?? []) {
    for (const code of extractStringArray(row.totallyIgnoredCodes)) {
      if (bucketCodes.has(code) && !included.has(code) && !excluded.has(code)) {
        ignored.add(code);
      }
    }
  }

  let orphan = 0;
  for (const code of bucketCodes) {
    if (included.has(code)) {
      statusByCode.set(code, 'included');
    } else if (excluded.has(code)) {
      statusByCode.set(code, 'excluded');
    } else if (ignored.has(code)) {
      statusByCode.set(code, 'ignored');
    } else {
      statusByCode.set(code, 'orphan');
      orphan += 1;
    }
  }

  return {
    hasConsolidatedOutput: true,
    numIncludedCodes: included.size,
    numExcludedCodes: excluded.size,
    numTotallyIgnoredCodes: ignored.size,
    numOrphanCodes: orphan,
    hasAnyStatusInfo: included.size + excluded.size + ignored.size > 0,
    statusByCode,
  };
}

export function deriveReviewCategories(
  mappingByCategory: Record<string, ConsolidationMappingSummary>,
): string[] {
  return Object.keys(mappingByCategory).sort((a, b) => a.localeCompare(b));
}

export function getConsolidationActionLabel({
  hasOutput,
  isConsolidating,
}: {
  hasOutput: boolean;
  isConsolidating: boolean;
}): string {
  if (isConsolidating) return 'Rebuilding…';
  return hasOutput ? 'Re-run consolidation' : 'Run consolidation';
}
