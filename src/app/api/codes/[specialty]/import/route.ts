/**
 * Bulk code-import endpoint (mapping file upload — XLSX + CSV).
 *
 * POST /api/codes/[specialty]/import   (multipart/form-data)
 *   fields:
 *     file    — the .xlsx or .csv file
 *     mode    — 'preview' | 'commit'
 *     sources — JSON string[] of source values to include (commit only)
 *
 * Merge/upsert only — never deletes. Matches overwrite metadata columns; new
 * codes are inserted unmapped. Gated on the consolidation lock (409, same
 * wording as the per-code PATCH route) so a stale tab can't mutate codes while
 * consolidation is running.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { createCodeSource, listCodeSources } from '@/lib/data/code-sources';
import { listCodeStrings, upsertCodesAsAdmin } from '@/lib/data/codes';
import { getConsolidationLockState } from '@/lib/data/pipeline';
import { errorMessage } from '@/lib/error-message';
import { type ParsedCodeRow, parseCodeImportFile } from '@/lib/import/code-import';
import { log } from '@/lib/log';

const MAX_BYTES = 20 * 1024 * 1024;

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Last-one-wins dedupe by code, preserving file order of the surviving rows. */
function dedupeByCode(rows: ParsedCodeRow[]): ParsedCodeRow[] {
  const byCode = new Map<string, ParsedCodeRow>();
  for (const r of rows) byCode.set(r.code, r);
  return [...byCode.values()];
}

const NO_SOURCE = '';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);

  const lock = await getConsolidationLockState(slug);
  if (lock.locked) {
    return NextResponse.json(
      {
        error: 'Consolidation is active — reset the consolidation stage to edit codes.',
      },
      { status: 409 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'missing or invalid `file` field' },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }
  const mode = form.get('mode');
  if (mode !== 'preview' && mode !== 'commit') {
    return NextResponse.json(
      { error: '`mode` must be preview or commit' },
      { status: 400 },
    );
  }

  let parsed: Awaited<ReturnType<typeof parseCodeImportFile>>;
  try {
    parsed = await parseCodeImportFile(await file.arrayBuffer(), file.name);
  } catch (e) {
    log('codes').error('import parse failed:', e);
    return NextResponse.json(
      { error: `Could not read the file: ${errorMessage(e)}` },
      { status: 400 },
    );
  }

  const deduped = dedupeByCode(parsed.rows);
  const existing = new Set(await listCodeStrings(slug));
  const registry = await listCodeSources();
  const inRegistry = (value: string) =>
    value !== NO_SOURCE &&
    registry.some((s) => s.name === value || s.slug === slugify(value));

  if (mode === 'preview') {
    const bySource = new Map<
      string,
      { rowCount: number; createCount: number; updateCount: number }
    >();
    let overwriteCount = 0;
    for (const row of deduped) {
      const src = row.source ?? NO_SOURCE;
      const bucket = bySource.get(src) ?? { rowCount: 0, createCount: 0, updateCount: 0 };
      bucket.rowCount++;
      if (existing.has(row.code)) {
        bucket.updateCount++;
        overwriteCount++;
      } else {
        bucket.createCount++;
      }
      bySource.set(src, bucket);
    }

    const sources = [...bySource.entries()]
      .map(([value, counts]) => ({
        value,
        rowCount: counts.rowCount,
        createCount: counts.createCount,
        updateCount: counts.updateCount,
        existsInRegistry: inRegistry(value),
      }))
      .sort((a, b) => a.value.localeCompare(b.value));

    return NextResponse.json({
      totalRows: parsed.rows.length + parsed.errors.length,
      validRows: deduped.length,
      errors: parsed.errors,
      duplicateCodesInFile: parsed.duplicateCodes,
      overwriteCount,
      sources,
    });
  }

  // --- commit ---------------------------------------------------------------
  let selected: Set<string>;
  try {
    const raw = form.get('sources');
    const arr = typeof raw === 'string' ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) throw new Error('not an array');
    selected = new Set(arr.map((v) => String(v)));
  } catch {
    return NextResponse.json(
      { error: '`sources` must be a JSON array of source values' },
      { status: 400 },
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: parsed.errors[0]?.message ?? 'No valid rows to import.' },
      { status: 400 },
    );
  }

  const rowsToImport = deduped.filter((r) => selected.has(r.source ?? NO_SOURCE));
  const skippedSources = [
    ...new Set(deduped.map((r) => r.source ?? NO_SOURCE).filter((v) => !selected.has(v))),
  ].sort();

  // Register any selected source value that isn't already in the registry.
  let newSourcesRegistered = 0;
  for (const value of selected) {
    if (value === NO_SOURCE || inRegistry(value)) continue;
    await createCodeSource(slugify(value), value);
    newSourcesRegistered++;
  }

  try {
    const { created, updated } = await upsertCodesAsAdmin(slug, rowsToImport);
    log('codes').info('import commit', {
      slug,
      created,
      updated,
      newSourcesRegistered,
    });
    return NextResponse.json({ created, updated, skippedSources, newSourcesRegistered });
  } catch (e) {
    log('codes').error('import commit failed:', e);
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
