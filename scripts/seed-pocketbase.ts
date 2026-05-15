/**
 * One-shot seed: copies xlsx fixtures into PocketBase. Idempotent — clears
 * each collection's rows for the slug before reinserting.
 *
 *   npm run seed:local
 *
 * Replaces both `scripts/seed-convex.ts` (editor data: codes / categories /
 * articles / sections) and `scripts/seed-from-xlsx.ts` (ontology: ICD10 /
 * HCUP / ABIM / Orpha) since both read from the same xlsx workbook and we no
 * longer need the per-script throttling Convex's free-tier required.
 *
 * Milestones (`specialties.milestones`) are NOT seeded here — run
 * `npm run import-milestones -- <slug> <file>` separately.
 *
 * Specialty registry rows (region/language/source='board') come from
 * `npm run import-board` against board_specialty_mapping_competencies.xlsx.
 */

import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { bulkCreate, clearCollection, pbAdminClient } from './_lib/pb';
import { buildXlsxRegistry, createXlsxRepos } from './_lib/xlsx';

const NOW = Date.now();

async function main(): Promise<void> {
  const registry = buildXlsxRegistry();
  if (registry.length === 0) {
    throw new Error(
      'No xlsx fixtures discovered. Drop a `<slug>_mapping.xlsx` at the repo root, or set LOCAL_XLSX_FIXTURES.',
    );
  }

  const pb = await pbAdminClient();
  const repos = createXlsxRepos(registry);

  // Upsert specialty rows first so per-specialty wipe-and-reseed has a
  // valid `specialtySlug` to scope by.
  console.log('seeding specialties …');
  for (const fx of registry) {
    try {
      const existing = await pb
        .collection('specialties')
        .getFirstListItem(`slug = "${fx.slug}"`);
      await pb.collection('specialties').update(existing.id, {
        name: fx.name,
        source: 'xlsx',
        xlsxPath: fx.xlsxPath,
        lastSeededAt: NOW,
      });
    } catch {
      await pb.collection('specialties').create({
        slug: fx.slug,
        name: fx.name,
        source: 'xlsx',
        xlsxPath: fx.xlsxPath,
        lastSeededAt: NOW,
      });
    }
  }
  console.log(`  ${registry.length} specialties`);

  for (const fx of registry) {
    const slug = fx.slug;
    const filter = `specialtySlug = "${slug}"`;
    console.log(`\n→ ${slug} (${fx.xlsxPath})`);

    const collections = [
      'codes',
      'codeCategories',
      'consolidatedArticles',
      'newArticleSuggestions',
      'articleUpdateSuggestions',
      'consolidatedSections',
      'icd10Codes',
      'hcupCodes',
      'abimCodes',
      'orphaCodes',
    ];
    for (const col of collections) {
      const removed = await clearCollection(pb, col, filter);
      if (removed > 0) console.log(`  cleared ${removed} ${col}`);
    }

    const [
      codes,
      categories,
      consolidatedArticles,
      newArticles,
      updateArticles,
      sections,
      icd10,
      hcup,
      abim,
      orpha,
    ] = await Promise.all([
      repos.codes.list(slug),
      repos.categories.list(slug),
      repos.articles.listConsolidated(slug),
      repos.articles.listNew(slug),
      repos.articles.listUpdates(slug),
      repos.sections.listConsolidated(slug),
      repos.sources.icd10(slug),
      repos.sources.hcup(slug),
      repos.sources.abim(slug),
      repos.sources.orpha(slug),
    ]);

    // Editor data ------------------------------------------------------
    if (categories.length > 0) {
      await bulkCreate(
        pb,
        'codeCategories',
        categories.map((r) => ({ ...stripUndef(r), specialtySlug: slug })),
      );
      console.log(`  inserted ${categories.length} codeCategories`);
    }
    if (codes.length > 0) {
      const cleaned = codes.map(
        ({ index: _i, fullJsonOutput: _fj, metadata: _md, ...rest }) =>
          normaliseCodeMappingShape({ ...stripUndef(rest), specialtySlug: slug }),
      );
      await bulkCreate(pb, 'codes', cleaned);
      console.log(`  inserted ${codes.length} codes`);
    }

    if (consolidatedArticles.length > 0) {
      await bulkCreate(
        pb,
        'consolidatedArticles',
        consolidatedArticles.map(({ index: _i, ...r }) => {
          const cleaned = { ...stripUndef(r), specialtySlug: slug };
          return {
            ...cleaned,
            articleKey: computeArticleKey({
              specialtySlug: slug,
              articleTitle: cleaned.articleTitle,
              articleId: cleaned.articleId,
            }),
          };
        }),
      );
      console.log(`  inserted ${consolidatedArticles.length} consolidatedArticles`);
    }
    if (newArticles.length > 0) {
      await bulkCreate(
        pb,
        'newArticleSuggestions',
        newArticles.map(({ index: _i, ...r }) => {
          const cleaned = { ...stripUndef(r), specialtySlug: slug };
          return {
            ...cleaned,
            articleKey: computeArticleKey({
              specialtySlug: slug,
              articleTitle: cleaned.articleTitle,
              articleId: cleaned.articleId,
            }),
          };
        }),
      );
      console.log(`  inserted ${newArticles.length} newArticleSuggestions`);
    }
    if (updateArticles.length > 0) {
      await bulkCreate(
        pb,
        'articleUpdateSuggestions',
        updateArticles.map(({ index: _i, ...r }) => {
          const cleaned = { ...stripUndef(r), specialtySlug: slug };
          return {
            ...cleaned,
            articleKey: computeArticleKey({
              specialtySlug: slug,
              articleTitle: cleaned.articleTitle,
              articleId: cleaned.articleId,
            }),
          };
        }),
      );
      console.log(`  inserted ${updateArticles.length} articleUpdateSuggestions`);
    }
    if (sections.length > 0) {
      await bulkCreate(
        pb,
        'consolidatedSections',
        sections.map(({ index: _i, ...r }) => {
          const cleaned = { ...stripUndef(r), specialtySlug: slug };
          return {
            ...cleaned,
            sectionKey: computeSectionKey({
              specialtySlug: slug,
              articleTitle: cleaned.articleTitle,
              articleId: cleaned.articleId,
              sectionName: cleaned.sectionName,
              sectionId: cleaned.sectionId,
            }),
          };
        }),
      );
      console.log(`  inserted ${sections.length} consolidatedSections`);
    }

    // Ontology — per-specialty rich-shape rows. Field shapes match the PB
    // collection definitions in the ontology_rich_schema migration.
    if (icd10.length > 0) {
      await bulkCreate(
        pb,
        'icd10Codes',
        icd10.map((r) => ({ ...stripUndef(r), specialtySlug: slug })),
      );
      console.log(`  inserted ${icd10.length} icd10Codes`);
    }
    if (hcup.length > 0) {
      await bulkCreate(
        pb,
        'hcupCodes',
        hcup.map((r) => ({ ...stripUndef(r), specialtySlug: slug })),
      );
      console.log(`  inserted ${hcup.length} hcupCodes`);
    }
    if (abim.length > 0) {
      await bulkCreate(
        pb,
        'abimCodes',
        abim.map((r) => ({
          abimIndex: r.Index,
          primaryCategory: r.primaryCategory,
          secondaryCategory: r.secondaryCategory,
          tertiaryCategory: r.tertiaryCategory,
          disease: r.disease,
          specialty: r.Specialty,
          code: r.code,
          item: r.item,
          choice: r.choice,
          category: r.category,
          count: r.count,
          specialtySlug: slug,
        })),
      );
      console.log(`  inserted ${abim.length} abimCodes`);
    }
    if (orpha.length > 0) {
      await bulkCreate(
        pb,
        'orphaCodes',
        orpha.map((r) => ({
          orphaCode: r.orphaCode,
          parentOrphaCode: r.parentOrphaCode,
          specificName: r.specificName,
          parentCategory: r.parentCategory,
          orphaTargetFilenamesToInclude: r.orphaTargetFilenamesToInclude,
          icd10LettersToInclude: r.icd10lettersToInclude,
          count: r.count,
          specialtySlug: slug,
        })),
      );
      console.log(`  inserted ${orpha.length} orphaCodes`);
    }
  }

  console.log('\n✓ Seed complete.');
}

function stripUndef<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

type Anyish = Record<string, unknown>;

function pickStr(o: Anyish, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
}
function pickNum(o: Anyish, k: string): number | undefined {
  const v = o[k];
  return typeof v === 'number' ? v : undefined;
}
function pickBool(o: Anyish, k: string): boolean | undefined {
  const v = o[k];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * The xlsx fixtures hold the original LLM output for the mapping blobs
 * (parsed via Zod `.passthrough()`), so they may carry extra keys and the
 * LLM's `record<title, id>` form for `coveredSections.sections`. PB stores
 * these as `json` — extra keys are fine, but the workflow path normalises
 * to array form, so do the same here so seed and runtime data line up.
 */
function normaliseCodeMappingShape<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  if (Array.isArray(row.articlesWhereCoverageIs)) {
    out.articlesWhereCoverageIs = (row.articlesWhereCoverageIs as Anyish[]).map((b) => {
      const s = b.sections;
      let sections: Array<{ sectionTitle?: string; sectionId?: string }> | undefined;
      if (Array.isArray(s)) {
        sections = s.map((entry) => {
          const o = (entry ?? {}) as Anyish;
          return {
            sectionTitle: pickStr(o, 'sectionTitle'),
            sectionId: pickStr(o, 'sectionId'),
          };
        });
      } else if (s && typeof s === 'object') {
        sections = Object.entries(s as Anyish).map(([title, id]) => ({
          sectionTitle: title,
          sectionId: typeof id === 'string' ? id : undefined,
        }));
      }
      return {
        articleTitle: pickStr(b, 'articleTitle'),
        articleId: pickStr(b, 'articleId'),
        sections,
      };
    });
  }
  if (Array.isArray(row.existingArticleUpdates)) {
    out.existingArticleUpdates = (row.existingArticleUpdates as Anyish[]).map((b) => ({
      articleTitle: pickStr(b, 'articleTitle'),
      articleId: pickStr(b, 'articleId'),
      sections: Array.isArray(b.sections)
        ? (b.sections as Anyish[]).map((s) => ({
            sectionTitle: pickStr(s, 'sectionTitle'),
            sectionId: pickStr(s, 'sectionId'),
            exists: pickBool(s, 'exists'),
            changes: pickStr(s, 'changes'),
            importance: pickNum(s, 'importance'),
          }))
        : undefined,
    }));
  }
  if (Array.isArray(row.newArticlesNeeded)) {
    out.newArticlesNeeded = (row.newArticlesNeeded as Anyish[]).map((b) => ({
      articleTitle: pickStr(b, 'articleTitle'),
      importance: pickNum(b, 'importance'),
    }));
  }
  return out as T;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
