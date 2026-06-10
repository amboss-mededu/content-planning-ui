import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseCodeImportFile, parseCsv } from './code-import';

function csvBuf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

async function xlsxBuf(rows: Array<Array<string | number>>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  const out = await wb.xlsx.writeBuffer();
  return out as ArrayBuffer;
}

const HEADER = 'source,code,description,category,consolidation category';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with embedded commas and quotes', () => {
    const out = parseCsv('code,desc\nA1,"hello, ""world"""');
    expect(out).toEqual([
      ['code', 'desc'],
      ['A1', 'hello, "world"'],
    ]);
  });

  it('handles embedded newlines inside quotes', () => {
    const out = parseCsv('code,desc\nA1,"line1\nline2"');
    expect(out).toEqual([
      ['code', 'desc'],
      ['A1', 'line1\nline2'],
    ]);
  });

  it('handles CRLF line endings and trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a leading BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseCodeImportFile (CSV)', () => {
  it('parses rows with aliased + reordered headers', async () => {
    const csv =
      'Code,Source,Description,Consolidation_Category,Category\nI10,ICD10,Hypertension,Cardio,Circulatory';
    const res = await parseCodeImportFile(csvBuf(csv), 'x.csv');
    expect(res.errors).toEqual([]);
    expect(res.rows).toEqual([
      {
        source: 'ICD10',
        code: 'I10',
        description: 'Hypertension',
        category: 'Circulatory',
        consolidationCategory: 'Cardio',
      },
    ]);
  });

  it('reports missing required headers with a helpful message', async () => {
    const csv = 'code,description\nA1,foo';
    const res = await parseCodeImportFile(csvBuf(csv), 'x.csv');
    expect(res.rows).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toContain('"source"');
    expect(res.errors[0].message).toContain('"category"');
    expect(res.errors[0].message).toContain('"consolidation category"');
  });

  it('errors on rows with a blank code, keeps the valid ones', async () => {
    const csv = `${HEADER}\nICD10,,desc,cat,bucket\nICD10,A1,desc,cat,bucket`;
    const res = await parseCodeImportFile(csvBuf(csv), 'x.csv');
    expect(res.rows.map((r) => r.code)).toEqual(['A1']);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].line).toBe(2);
  });

  it('leaves blank optional cells undefined', async () => {
    const csv = `${HEADER}\n,A1,,,`;
    const res = await parseCodeImportFile(csvBuf(csv), 'x.csv');
    expect(res.rows).toEqual([
      {
        code: 'A1',
        source: undefined,
        description: undefined,
        category: undefined,
        consolidationCategory: undefined,
      },
    ]);
  });

  it('flags in-file duplicate codes', async () => {
    const csv = `${HEADER}\nICD10,A1,first,cat,b\nICD10,A1,second,cat,b\nICD10,B2,x,cat,b`;
    const res = await parseCodeImportFile(csvBuf(csv), 'x.csv');
    expect(res.duplicateCodes).toEqual(['A1']);
    expect(res.rows).toHaveLength(3);
  });
});

describe('parseCodeImportFile (XLSX)', () => {
  it('parses an xlsx with parity to CSV', async () => {
    const buf = await xlsxBuf([
      ['source', 'code', 'description', 'category', 'consolidation category'],
      ['ICD10', 'I10', 'Hypertension', 'Circulatory', 'Cardio'],
    ]);
    const res = await parseCodeImportFile(buf, 'x.xlsx');
    expect(res.errors).toEqual([]);
    expect(res.rows).toEqual([
      {
        source: 'ICD10',
        code: 'I10',
        description: 'Hypertension',
        category: 'Circulatory',
        consolidationCategory: 'Cardio',
      },
    ]);
  });

  it('reports missing headers in xlsx too', async () => {
    const buf = await xlsxBuf([
      ['code', 'description'],
      ['A1', 'foo'],
    ]);
    const res = await parseCodeImportFile(buf, 'x.xlsx');
    expect(res.rows).toEqual([]);
    expect(res.errors[0].message).toContain('"source"');
  });
});

describe('parseCodeImportFile (unsupported)', () => {
  it('rejects unknown extensions', async () => {
    const res = await parseCodeImportFile(csvBuf('a,b'), 'x.json');
    expect(res.rows).toEqual([]);
    expect(res.errors[0].message).toContain('Unsupported file type');
  });
});
