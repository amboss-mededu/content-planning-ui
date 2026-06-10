import 'server-only';

import ExcelJS from 'exceljs';
import { z } from 'zod';

/**
 * Parses an uploaded mapping file (XLSX or CSV) into normalized code rows.
 *
 * The file carries the mapping *metadata* columns — source, code, description,
 * category, consolidation category — that editors maintain outside the LLM
 * pipeline. Only `code` is required per row; the other cells are optional and
 * blank cells become `undefined` (so the upsert leaves the existing value
 * untouched rather than blanking it). Mapping results (coverage, suggestions,
 * `mappedAt`) are never represented here — this is purely the input ontology.
 *
 * Header matching is case/whitespace/punctuation-insensitive with a few
 * aliases (see HEADER_ALIASES). All five recognized columns must be present as
 * headers; a missing one yields a single helpful error rather than silently
 * dropping data.
 */
export type ParsedCodeRow = {
  source?: string;
  code: string;
  description?: string;
  category?: string;
  consolidationCategory?: string;
};

export type CodeImportParseResult = {
  rows: ParsedCodeRow[];
  errors: Array<{ line: number; message: string }>;
  /** Codes that appear more than once in the file (last-one-wins at commit). */
  duplicateCodes: string[];
};

type FieldKey = keyof ParsedCodeRow;

const REQUIRED_HEADERS: Record<FieldKey, string> = {
  source: 'source',
  code: 'code',
  description: 'description',
  category: 'category',
  consolidationCategory: 'consolidation category',
};

// Normalized-header → field. Normalization strips case and every non-alphanumeric
// character, so "Consolidation_Category", "consolidation category", and
// "ConsolidationCategory" all collapse to the same key.
const HEADER_ALIASES: Record<string, FieldKey> = {
  source: 'source',
  code: 'code',
  description: 'description',
  desc: 'description',
  category: 'category',
  sourcecategory: 'category',
  consolidationcategory: 'consolidationCategory',
  consolidationbucket: 'consolidationCategory',
  bucket: 'consolidationCategory',
};

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const NULLISH = new Set(['', '#n/a', '#ref!', '#name?', '#value!', '#div/0!']);

function cleanCell(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  return NULLISH.has(s.toLowerCase()) ? undefined : s;
}

const RowSchema = z.object({
  source: z.string().trim().min(1).optional(),
  code: z.string().trim().min(1, 'code is required'),
  description: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  consolidationCategory: z.string().trim().min(1).optional(),
});

/**
 * RFC-4180 CSV parser: quoted fields, escaped quotes (`""`), embedded commas
 * and newlines, CRLF or LF line endings. Returns a matrix of raw string cells.
 * Trailing blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  // Strip a leading UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      // Swallow CRLF as a single line break.
      if (text[i + 1] === '\n') i++;
      pushRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the final field/row unless the file ended exactly on a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop fully-empty rows (e.g. a stray trailing blank line).
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as {
      text?: string;
      result?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: string;
    };
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.richText))
      return obj.richText.map((r) => r.text ?? '').join('');
    if ('result' in obj && obj.result != null) return String(obj.result);
    if (value instanceof Date) return value.toISOString();
    return '';
  }
  return String(value);
}

async function readXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const values = Array.isArray(r.values) ? (r.values as unknown[]).slice(1) : [];
    const cells = values.map(cellToString);
    if (cells.some((c) => c.trim().length > 0)) rows.push(cells);
  });
  return rows;
}

/**
 * Maps header cells to field keys. Returns the index→field mapping plus the
 * list of recognized fields that were not found in the header row.
 */
function mapHeaders(headerRow: string[]): {
  index: Partial<Record<FieldKey, number>>;
  missing: FieldKey[];
} {
  const index: Partial<Record<FieldKey, number>> = {};
  headerRow.forEach((h, i) => {
    const field = HEADER_ALIASES[normalizeHeader(h)];
    if (field && index[field] === undefined) index[field] = i;
  });
  const missing = (Object.keys(REQUIRED_HEADERS) as FieldKey[]).filter(
    (f) => index[f] === undefined,
  );
  return { index, missing };
}

function rowsToResult(matrix: string[][]): CodeImportParseResult {
  if (matrix.length === 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: 'The file is empty.' }],
      duplicateCodes: [],
    };
  }
  const { index, missing } = mapHeaders(matrix[0]);
  if (missing.length > 0) {
    const names = missing.map((f) => `"${REQUIRED_HEADERS[f]}"`).join(', ');
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: `Missing required column(s): ${names}. Expected headers: ${Object.values(
            REQUIRED_HEADERS,
          )
            .map((h) => `"${h}"`)
            .join(', ')}.`,
        },
      ],
      duplicateCodes: [],
    };
  }

  const rows: ParsedCodeRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const seen = new Set<string>();
  const dupes = new Set<string>();

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    const at = (f: FieldKey) => {
      const i = index[f];
      return i === undefined ? undefined : cleanCell(cells[i]);
    };
    const candidate = {
      source: at('source'),
      code: at('code'),
      description: at('description'),
      category: at('category'),
      consolidationCategory: at('consolidationCategory'),
    };
    const parsed = RowSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        line: r + 1,
        message: parsed.error.issues.map((iss) => iss.message).join('; '),
      });
      continue;
    }
    const row = parsed.data;
    if (seen.has(row.code)) dupes.add(row.code);
    seen.add(row.code);
    rows.push(row);
  }

  return { rows, errors, duplicateCodes: [...dupes].sort() };
}

export async function parseCodeImportFile(
  buf: ArrayBuffer,
  filename: string,
): Promise<CodeImportParseResult> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = new TextDecoder('utf-8').decode(buf);
    return rowsToResult(parseCsv(text));
  }
  if (lower.endsWith('.xlsx')) {
    return rowsToResult(await readXlsxRows(buf));
  }
  return {
    rows: [],
    errors: [{ line: 1, message: 'Unsupported file type. Upload a .xlsx or .csv file.' }],
    duplicateCodes: [],
  };
}
