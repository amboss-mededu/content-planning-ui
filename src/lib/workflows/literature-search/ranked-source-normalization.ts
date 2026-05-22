export type NormalizedRankedSource = {
  title: string;
  doi?: string;
  url?: string;
  journal?: string;
  journalNlm?: string;
  sourceType?:
    | 'guideline'
    | 'systematic_review'
    | 'clinical_review'
    | 'meta_analysis'
    | 'case_report'
    | 'vet_content'
    | 'non_english'
    | 'other';
  predatoryJournalRisk?: 'none' | 'low' | 'medium' | 'high' | 'predatory';
  rank: number;
  subtopics?: string;
  llmSummary?: string;
  justification?: string;
  superseded?: boolean;
};

const SOURCE_TYPES = [
  'guideline',
  'systematic_review',
  'clinical_review',
  'meta_analysis',
  'case_report',
  'vet_content',
  'non_english',
  'other',
] as const;

const PREDATORY_RISKS = ['none', 'low', 'medium', 'high', 'predatory'] as const;

const SOURCE_TYPE_ALIASES: Record<string, NormalizedRankedSource['sourceType']> = {
  guideline: 'guideline',
  guidelines: 'guideline',
  'clinical guideline': 'guideline',
  'clinical guidelines': 'guideline',
  'practice guideline': 'guideline',
  'practice guidelines': 'guideline',
  systematic_review: 'systematic_review',
  'systematic review': 'systematic_review',
  systematicreview: 'systematic_review',
  meta_analysis: 'meta_analysis',
  'meta analysis': 'meta_analysis',
  'meta-analysis': 'meta_analysis',
  metaanalysis: 'meta_analysis',
  clinical_review: 'clinical_review',
  'clinical review': 'clinical_review',
  'narrative review': 'clinical_review',
  review: 'clinical_review',
  case_report: 'case_report',
  'case report': 'case_report',
  'case study': 'case_report',
  vet_content: 'vet_content',
  veterinary: 'vet_content',
  'veterinary content': 'vet_content',
  non_english: 'non_english',
  'non english': 'non_english',
  'non-english': 'non_english',
  other: 'other',
};

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeSourceType(value: unknown): NormalizedRankedSource['sourceType'] {
  const raw = stringOrUndefined(value);
  if (!raw) return undefined;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');
  const alias = SOURCE_TYPE_ALIASES[key];
  if (alias) return alias;
  return (SOURCE_TYPES as readonly string[]).includes(raw)
    ? (raw as NormalizedRankedSource['sourceType'])
    : 'other';
}

function normalizePredatoryRisk(
  value: unknown,
): NormalizedRankedSource['predatoryJournalRisk'] {
  const raw = stringOrUndefined(value)?.toLowerCase();
  if (!raw) return undefined;
  return (PREDATORY_RISKS as readonly string[]).includes(raw)
    ? (raw as NormalizedRankedSource['predatoryJournalRisk'])
    : undefined;
}

function normalizeRank(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export function normalizeRankedSourceRows(rawRows: unknown[]): NormalizedRankedSource[] {
  const out: NormalizedRankedSource[] = [];
  for (const [index, raw] of rawRows.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const title = stringOrUndefined(row.title);
    if (!title) continue;
    out.push({
      title,
      doi: stringOrUndefined(row.doi),
      url: stringOrUndefined(row.url),
      journal: stringOrUndefined(row.journal),
      journalNlm: stringOrUndefined(row.journalNlm),
      sourceType: normalizeSourceType(row.sourceType),
      predatoryJournalRisk: normalizePredatoryRisk(row.predatoryJournalRisk),
      rank: normalizeRank(row.rank, index + 1),
      subtopics: stringOrUndefined(row.subtopics),
      llmSummary: stringOrUndefined(row.llmSummary),
      justification: stringOrUndefined(row.justification),
      superseded: booleanOrUndefined(row.superseded),
    });
  }
  return out.sort((a, b) => a.rank - b.rank);
}
