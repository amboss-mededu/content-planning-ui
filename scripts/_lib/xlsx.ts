/**
 * Xlsx ingest helpers, used only by CLI seed scripts.
 *
 * PocketBase is the runtime source of truth; xlsx fixtures are only
 * consumed at seed time, so this code has no place in the app bundle.
 */

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { env } from '@/env';

// --- Tab names + header constants -----------------------------------------

export const TAB = {
  Stats: 'Stats',
  CodeAmbossMapping: 'Code_Amboss_Mapping',
  CodeCategories: 'Code_Categories',
  ConsolidatedArticles: 'Consolidated_Articles',
  ConsolidatedSections: 'Section_Suggestions',
  ArticleUpdateSuggestions: 'Article_Update_Suggestions',
  NewArticleSuggestions: 'New_Article_Suggestions',
  SpecialtyIcd10Codes: 'Specialty_ICD10_Codes',
  SpecialtyIcd10CodesHcup: 'Specialty_ICD10_Codes_HCUP',
  SpecialtyAbimExpandedContent: 'Specialty_ABIM_Expanded_Content',
  SpecialtyOrphaCodes: 'Specialty_OrphaCodes',
  AllOrphaCodes: 'All_OrphaCodes',
} as const;

// --- Workbook reader ------------------------------------------------------

export type Row = Array<string | number | null | undefined>;

const workbookCache = new Map<string, { mtimeMs: number; wb: ExcelJS.Workbook }>();

async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const stat = await fs.stat(abs);
  const cached = workbookCache.get(abs);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.wb;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(abs);
  workbookCache.set(abs, { mtimeMs: stat.mtimeMs, wb });
  return wb;
}

export async function readTabRows(filePath: string, tabName: string): Promise<Row[]> {
  const wb = await loadWorkbook(filePath);
  const ws = wb.getWorksheet(tabName);
  if (!ws) return [];
  const rows: Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
    rows.push(
      values.map((v) => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === 'object') {
          const obj = v as {
            text?: string;
            result?: unknown;
            richText?: Array<{ text?: string }>;
          };
          if (typeof obj.text === 'string') return obj.text;
          if (obj.richText) return obj.richText.map((r) => r.text ?? '').join('');
          if ('result' in obj) return obj.result as string | number;
          if (v instanceof Date) return v.toISOString();
          return String(v);
        }
        return v as string | number;
      }),
    );
  });
  return rows;
}

// --- Cell parsing ---------------------------------------------------------

const NULLISH_STRINGS = new Set(['', '#N/A', '#REF!', '#NAME?', '#VALUE!', '#DIV/0!']);

export function cleanCell(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (NULLISH_STRINGS.has(s)) return undefined;
  return s;
}

function jsonCell<T>(schema: z.ZodType<T>) {
  return (raw: unknown, ctx: z.RefinementCtx): T | undefined => {
    const cleaned = cleanCell(raw);
    if (cleaned === undefined) return undefined;
    try {
      const parsed = JSON.parse(cleaned);
      const result = schema.safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid JSON shape: ${result.error.message}`,
        });
        return undefined;
      }
      return result.data;
    } catch (e) {
      ctx.addIssue({
        code: 'custom',
        message: `Unparseable JSON cell: ${(e as Error).message}`,
      });
      return undefined;
    }
  };
}

// --- Row → object + parsing pipeline --------------------------------------

function buildHeaderMap(headerRow: Row): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = cleanCell(h);
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

function rowToObject(row: Row, headerMap: Map<string, number>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, idx] of headerMap) obj[key] = row[idx];
  return obj;
}

interface ParseOptions {
  skipDescriptionRow?: boolean;
  tabName: string;
}

interface ParseResult<T> {
  items: T[];
  errors: Array<{ rowIndex: number; message: string }>;
}

export function parseRows<T>(
  allRows: Row[],
  schema: z.ZodType<T>,
  opts: ParseOptions,
): ParseResult<T> {
  if (allRows.length === 0) return { items: [], errors: [] };
  const headerMap = buildHeaderMap(allRows[0]);
  const dataStart = opts.skipDescriptionRow === false ? 1 : 2;
  const items: T[] = [];
  const errors: Array<{ rowIndex: number; message: string }> = [];
  for (let i = dataStart; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row || row.every((c) => cleanCell(c) === undefined)) continue;
    const obj = rowToObject(row, headerMap);
    const result = schema.safeParse(obj);
    if (result.success) {
      items.push(result.data);
    } else {
      errors.push({ rowIndex: i + 1, message: result.error.message });
    }
  }
  if (errors.length > 0) {
    console.warn(
      `[parse:${opts.tabName}] skipped ${errors.length} row(s):`,
      errors.slice(0, 3),
    );
  }
  return { items, errors };
}

// --- Schemas (xlsx → typed row) -------------------------------------------

const stringOpt = z.unknown().transform((v) => cleanCell(v));
const numberOpt = z.unknown().transform((v) => {
  const c = cleanCell(v);
  if (c === undefined) return undefined;
  const n = Number(c);
  return Number.isFinite(n) ? n : undefined;
});
const boolOpt = z.unknown().transform((v) => {
  const c = cleanCell(v);
  if (c === undefined) return undefined;
  if (c === '1' || c.toLowerCase() === 'true') return true;
  if (c === '0' || c.toLowerCase() === 'false') return false;
  return undefined;
});

const COVERAGE_LEVELS = [
  'none',
  'student',
  'early-resident',
  'advanced-resident',
  'attending',
  'specialist',
] as const;
type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

const coverageLevelOpt = z.unknown().transform((v) => {
  const c = cleanCell(v);
  if (!c) return undefined;
  return (COVERAGE_LEVELS as readonly string[]).includes(c)
    ? (c as CoverageLevel)
    : undefined;
});

const ArticleCoverageRefSchema = z
  .object({
    articleTitle: z.string().optional(),
    articleId: z.string().optional(),
    sectionName: z.string().optional(),
  })
  .passthrough();
const ArticleUpdateSchema = z
  .object({
    articleTitle: z.string().optional(),
    articleId: z.string().optional(),
    sectionName: z.string().optional(),
    suggestion: z.string().optional(),
  })
  .passthrough();
const NewArticleRefSchema = z
  .object({
    articleTitle: z.string().optional(),
    justification: z.string().optional(),
  })
  .passthrough();

export const CodeSchema = z
  .object({
    index: stringOpt,
    specialty: stringOpt,
    source: stringOpt,
    code: stringOpt,
    category: stringOpt,
    consolidationCategory: stringOpt,
    description: stringOpt,
    isInAMBOSS: boolOpt,
    articlesWhereCoverageIs: z
      .unknown()
      .transform(jsonCell(z.array(ArticleCoverageRefSchema))),
    notes: stringOpt,
    gaps: stringOpt,
    coverageLevel: coverageLevelOpt,
    depthOfCoverage: numberOpt,
    existingArticleUpdates: z.unknown().transform(jsonCell(z.array(ArticleUpdateSchema))),
    newArticlesNeeded: z.unknown().transform(jsonCell(z.array(NewArticleRefSchema))),
    improvements: stringOpt,
    metadata: z.unknown().transform(jsonCell(z.unknown())),
    fullJsonOutput: z.unknown().transform(jsonCell(z.unknown())),
  })
  .transform((c) => ({ ...c, code: c.code ?? '' }));

export const CodeCategorySchema = z.object({
  codeCategory: stringOpt,
  source: stringOpt,
  areAllCodesRun: boolOpt,
  isConsolidated: boolOpt,
  description: stringOpt,
  numCodes: numberOpt,
  totalArticleCodes: numberOpt,
  totalSectionCodes: numberOpt,
  codesToIgnore: stringOpt,
  numIncludedCodes: numberOpt,
  includedArticleCodes: z.unknown().transform(jsonCell(z.array(z.string()))),
  numIncludedArticleCodes: numberOpt,
  excludedArticleCodes: z.unknown().transform(jsonCell(z.array(z.string()))),
  numExcludedArticleCodes: numberOpt,
  includedSectionCodes: z.unknown().transform(jsonCell(z.array(z.string()))),
  numIncludedSectionCodes: numberOpt,
  excludedSectionCodes: z.unknown().transform(jsonCell(z.array(z.string()))),
  numExcludedSectionCodes: numberOpt,
  totallyIgnoredCodes: z.unknown().transform(jsonCell(z.array(z.string()))),
  numTotallyIgnoredCodes: numberOpt,
});

export const ConsolidatedArticleSchema = z.object({
  index: stringOpt,
  articleTitle: stringOpt,
  articleType: stringOpt,
  specialtyName: stringOpt,
  category: stringOpt,
  articleId: stringOpt,
  numCodes: numberOpt,
  codes: z.unknown().transform(jsonCell(z.array(z.record(z.string(), z.unknown())))),
  previousArticleTitleSuggestions: z.unknown().transform(jsonCell(z.array(z.string()))),
  overallCoverage: numberOpt,
  overallImportance: numberOpt,
  justification: stringOpt,
});

export const ConsolidatedSectionSchema = z.object({
  index: stringOpt,
  assignedEditor: stringOpt,
  editorInTheLoopReview: stringOpt,
  articleTitle: stringOpt,
  articleType: stringOpt,
  articleId: stringOpt,
  sectionName: stringOpt,
  newSection: boolOpt,
  sectionUpdate: boolOpt,
  newPhrase: stringOpt,
  specialtyName: stringOpt,
  category: stringOpt,
  unique_title: stringOpt,
  uniqueId: stringOpt,
  numCodes: numberOpt,
  codes: z.unknown().transform(jsonCell(z.array(z.record(z.string(), z.unknown())))),
  previousSectionNames: z.unknown().transform(jsonCell(z.array(z.string()))),
  exists: boolOpt,
  sectionId: stringOpt,
  overallCoverage: numberOpt,
  overallImportance: numberOpt,
  justification: stringOpt,
  isSearched: boolOpt,
  llmSearchTerms: stringOpt,
  verdict: stringOpt,
  justifcation: stringOpt,
  isSufficientlyCovered: boolOpt,
  areAllSourcesFetched: boolOpt,
});

export const NewArticleSuggestionSchema = z.object({
  index: stringOpt,
  assignedEditor: stringOpt,
  editorInTheLoopReview: stringOpt,
  newArticle: boolOpt,
  articleMaintenance: boolOpt,
  articleTitle: stringOpt,
  alternateTitles: stringOpt,
  articleProgress: stringOpt,
  articleType: stringOpt,
  specialtyName: stringOpt,
  articleId: stringOpt,
  codes: z.unknown().transform(jsonCell(z.array(z.record(z.string(), z.unknown())))),
  literatureSearchTerms: stringOpt,
  sections: stringOpt,
  previousArticleTitleSuggestions: z.unknown().transform(jsonCell(z.array(z.string()))),
  previousConsolidationIndexes: z.unknown().transform(jsonCell(z.array(z.number()))),
  existingAmbossCoverage: stringOpt,
  overallImportance: numberOpt,
  justification: stringOpt,
  isSearched: boolOpt,
  llmSearchTerms: stringOpt,
  verdict: stringOpt,
  justifcation: stringOpt,
  isSufficientlyCovered: boolOpt,
  areAllSourcesFetched: boolOpt,
});

export const ArticleUpdateSuggestionSchema = NewArticleSuggestionSchema;

export const IcdCodeSchema = z.object({
  codeCategory: stringOpt,
  codeCategoryDescription: stringOpt,
  icd10Code: stringOpt,
  icd10CodeDescription: stringOpt,
});

export const AbimCodeSchema = z.object({
  Index: stringOpt,
  primaryCategory: stringOpt,
  secondaryCategory: stringOpt,
  tertiaryCategory: stringOpt,
  disease: stringOpt,
  Specialty: stringOpt,
  code: stringOpt,
  item: stringOpt,
  choice: stringOpt,
  category: stringOpt,
  count: numberOpt,
});

export const OrphaCodeSchema = z.object({
  orphaCode: stringOpt,
  parentOrphaCode: stringOpt,
  specificName: stringOpt,
  parentCategory: stringOpt,
  orphaTargetFilenamesToInclude: stringOpt,
  icd10lettersToInclude: stringOpt,
  count: numberOpt,
});

// --- Registry + repos -----------------------------------------------------

interface RegistryEntry {
  slug: string;
  name: string;
  xlsxPath: string;
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function buildXlsxRegistry(): RegistryEntry[] {
  const explicit = Object.entries(env.LOCAL_XLSX_FIXTURES ?? {}).map(
    ([slug, xlsxPath]) => ({
      slug,
      name: titleCase(slug),
      xlsxPath,
    }),
  );
  const defaultFixturePath = path.join(process.cwd(), 'anesthesiology_mapping.xlsx');
  const hasDefault = existsSync(defaultFixturePath);
  const hasExplicitAnesthesiology = explicit.some((e) => e.slug === 'anesthesiology');
  if (hasDefault && !hasExplicitAnesthesiology) {
    explicit.push({
      slug: 'anesthesiology',
      name: 'Anesthesiology',
      xlsxPath: defaultFixturePath,
    });
  }
  return explicit;
}

function pathFor(registry: RegistryEntry[], slug: string): string | null {
  return registry.find((r) => r.slug === slug)?.xlsxPath ?? null;
}

/**
 * Mirror of the old `src/lib/repositories/xlsx/repos.ts` shape — intentionally
 * unchanged so the seed scripts that import this stay byte-identical at the
 * call sites. Could be flattened in a future pass if the seed entry points
 * are reorganised.
 */
export function createXlsxRepos(registry: RegistryEntry[]) {
  const specialties = {
    async list() {
      return registry.map((r) => ({
        slug: r.slug,
        name: r.name,
        source: 'xlsx' as const,
        xlsxPath: r.xlsxPath,
      }));
    },
  };

  const codes = {
    async list(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.CodeAmbossMapping);
      return parseRows(rows, CodeSchema, { tabName: TAB.CodeAmbossMapping }).items;
    },
  };

  const categories = {
    async list(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.CodeCategories);
      return parseRows(rows, CodeCategorySchema, { tabName: TAB.CodeCategories }).items;
    },
  };

  const articles = {
    async listConsolidated(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.ConsolidatedArticles);
      return parseRows(rows, ConsolidatedArticleSchema, {
        tabName: TAB.ConsolidatedArticles,
      }).items;
    },
    async listNew(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.NewArticleSuggestions);
      return parseRows(rows, NewArticleSuggestionSchema, {
        tabName: TAB.NewArticleSuggestions,
      }).items;
    },
    async listUpdates(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.ArticleUpdateSuggestions);
      return parseRows(rows, ArticleUpdateSuggestionSchema, {
        tabName: TAB.ArticleUpdateSuggestions,
      }).items;
    },
  };

  const sections = {
    async listConsolidated(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.ConsolidatedSections);
      return parseRows(rows, ConsolidatedSectionSchema, {
        tabName: TAB.ConsolidatedSections,
      }).items;
    },
  };

  const sources = {
    async icd10(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.SpecialtyIcd10Codes);
      return parseRows(rows, IcdCodeSchema, { tabName: TAB.SpecialtyIcd10Codes }).items;
    },
    async hcup(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.SpecialtyIcd10CodesHcup);
      return parseRows(rows, IcdCodeSchema, {
        tabName: TAB.SpecialtyIcd10CodesHcup,
      }).items;
    },
    async abim(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.SpecialtyAbimExpandedContent);
      return parseRows(rows, AbimCodeSchema, {
        tabName: TAB.SpecialtyAbimExpandedContent,
      }).items;
    },
    async orpha(slug: string) {
      const p = pathFor(registry, slug);
      if (!p) return [];
      const rows = await readTabRows(p, TAB.SpecialtyOrphaCodes);
      return parseRows(rows, OrphaCodeSchema, { tabName: TAB.SpecialtyOrphaCodes }).items;
    },
  };

  return { specialties, codes, categories, articles, sections, sources };
}
