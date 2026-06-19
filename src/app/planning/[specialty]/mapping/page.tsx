import { Suspense } from 'react';
import {
  listCategoryOrchestration,
  listSourceCategoryProgress,
} from '@/lib/data/categories';
import { listCodeSources } from '@/lib/data/code-sources';
import { listCodeCount, listCodeTableRowsPage } from '@/lib/data/codes';
import { getExtractionState } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { MappingView } from '../../_components/mapping-view';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function MappingPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;

  return (
    <Suspense fallback={<TableSkeleton columns={7} rows={15} />}>
      <MappingData slug={slug} />
    </Suspense>
  );
}

async function MappingData({ slug }: { slug: string }) {
  const [firstPage, rows, sourceRows, codeSources, codeCount, extraction, specialty] =
    await Promise.all([
      listCodeTableRowsPage(slug, 1, 200),
      listCategoryOrchestration(slug),
      listSourceCategoryProgress(slug),
      listCodeSources(),
      listCodeCount(slug),
      getExtractionState(slug),
      getSpecialty(slug),
    ]);

  return (
    <MappingView
      slug={slug}
      initialCodes={firstPage.items}
      initialHasMore={firstPage.hasMore}
      rows={rows}
      sourceRows={sourceRows}
      codeSources={codeSources.map((s) => ({ slug: s.slug, name: s.name }))}
      codeCount={codeCount}
      extractionState={extraction.extract_codes}
      mappingOnly={specialty?.mappingOnly ?? false}
      mappingSource={specialty?.mappingSource ?? 'amboss'}
    />
  );
}
