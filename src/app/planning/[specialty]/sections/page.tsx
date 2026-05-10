import { Suspense } from 'react';
import { listConsolidatedSections } from '@/lib/data/sections';
import type { ConsolidatedSection } from '@/lib/types';
import { extractCodes } from '../../_components/code-utils';
import { type SectionRow, SectionsView } from '../../_components/sections-view';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function SectionsPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={10} rows={10} />}>
      <SectionsData slug={slug} />
    </Suspense>
  );
}

function projectSection(r: ConsolidatedSection): SectionRow {
  const codes = extractCodes(r.codes);
  const updateType: 'new' | 'update' | null = r.newSection
    ? 'new'
    : r.sectionUpdate
      ? 'update'
      : null;
  return {
    articleTitle: r.articleTitle,
    articleId: r.articleId,
    sectionName: r.sectionName,
    updateType,
    category: r.category,
    codes,
    numCodes: r.numCodes ?? codes.length,
    overallImportance: r.overallImportance,
    overallCoverage: r.overallCoverage,
    justification: r.justification,
  };
}

async function SectionsData({ slug }: { slug: string }) {
  const recs = await listConsolidatedSections(slug);
  const rows = recs.map(projectSection);
  return <SectionsView rows={rows} />;
}
