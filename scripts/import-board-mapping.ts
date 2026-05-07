/**
 * Import specialty registry rows from board_specialty_mapping_competencies.xlsx.
 *
 * Usage:
 *   npm run import-board                  # import every specialty in every region tab
 *   npm run import-board -- dermatology   # import only dermatology
 *   npm run import-board -- psychiatry dermatology
 *
 * Only identity columns are populated: slug, name, region, language, source.
 * PDF URLs and system prompts are per-run inputs (live on pipelineRuns), not
 * specialty attributes — so this script doesn't touch them.
 *
 * Idempotent — existing rows are updated; `source` is preserved on conflict so
 * a specialty seeded from xlsx keeps its lineage.
 */

import { pbAdminClient } from './_lib/pb';
import { readTabRows } from './_lib/xlsx';

const WORKBOOK = 'board_specialty_mapping_competencies.xlsx';
const MASTER_TAB = 'master';

type RegionConfig = {
  region: string;
  language: string;
};

function normalizeCell(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

async function readRegions(): Promise<Map<string, RegionConfig>> {
  const rows = await readTabRows(WORKBOOK, MASTER_TAB);
  if (rows.length < 2) {
    throw new Error(`master tab has ${rows.length} rows — expected header + data`);
  }
  const header = rows[0].map((h) => normalizeCell(h) ?? '');
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`master tab missing column '${name}'`);
    return i;
  };
  const iRegion = idx('region');
  const iLang = idx('language');

  const out = new Map<string, RegionConfig>();
  for (const row of rows.slice(1)) {
    const region = normalizeCell(row[iRegion]);
    if (!region) continue;
    out.set(region, {
      region,
      language: normalizeCell(row[iLang]) ?? '',
    });
  }
  return out;
}

type SpecialtyRow = { slug: string; name: string };

async function readRegionSpecialties(region: string): Promise<SpecialtyRow[]> {
  const rows = await readTabRows(WORKBOOK, region);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => normalizeCell(h) ?? '');
  const iSpecialty = header.indexOf('specialty');
  if (iSpecialty < 0) {
    console.warn(`[import] tab '${region}' missing 'specialty' column — skipping`);
    return [];
  }
  const out: SpecialtyRow[] = [];
  for (const row of rows.slice(1)) {
    const specialty = normalizeCell(row[iSpecialty]);
    if (!specialty) continue;
    const slug = slugify(specialty);
    out.push({ slug, name: titleCase(slug) });
  }
  return out;
}

async function main() {
  const filter = new Set(process.argv.slice(2).map((s) => s.toLowerCase()));
  const pb = await pbAdminClient();
  const regions = await readRegions();
  console.log('[import] master regions:', [...regions.keys()]);
  if (filter.size > 0) console.log('[import] filter:', [...filter]);

  let upserts = 0;
  for (const [regionKey, cfg] of regions) {
    const specs = await readRegionSpecialties(regionKey);
    const selected = filter.size === 0 ? specs : specs.filter((s) => filter.has(s.slug));
    if (selected.length === 0) continue;
    console.log(`[import] ${regionKey}: ${selected.length} specialties`);
    for (const s of selected) {
      const payload = {
        slug: s.slug,
        name: s.name,
        source: 'board',
        region: cfg.region,
        language: cfg.language,
      };
      try {
        const existing = await pb
          .collection('specialties')
          .getFirstListItem(`slug = "${s.slug}"`);
        // Preserve original `source` on conflict — xlsx-seeded specialties
        // shouldn't be downgraded to 'board'.
        const { source: _drop, ...patch } = payload;
        await pb.collection('specialties').update(existing.id, patch);
      } catch {
        await pb.collection('specialties').create(payload);
      }
      upserts++;
    }
  }

  if (filter.size > 0 && upserts < filter.size) {
    const missing = [...filter];
    console.warn(
      `[import] WARNING: requested ${filter.size} slug(s), upserted ${upserts}. Check: ${missing.join(', ')}`,
    );
  }
  console.log(`[import] upserted ${upserts} specialties`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
