import { Suspense } from 'react';
import { listCodeSources } from '@/lib/data/code-sources';
import { listCodeTableRowsPage } from '@/lib/data/codes';
import { getExtractionState } from '@/lib/data/pipeline';
import { TableSkeleton } from '../../_components/table-skeleton';
import { CodesViewClient } from './codes-view-client';

export default async function CodesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;

  return (
    <Suspense fallback={<TableSkeleton columns={7} rows={15} />}>
      <CodesPageData slug={slug} />
    </Suspense>
  );
}

async function CodesPageData({ slug }: { slug: string }) {
  const [firstPage, codeSources, extraction] = await Promise.all([
    listCodeTableRowsPage(slug, 1, 200),
    listCodeSources(),
    getExtractionState(slug),
  ]);

  return (
    <CodesViewClient
      slug={slug}
      initialCodes={firstPage.items}
      initialHasMore={firstPage.hasMore}
      codeSources={codeSources.map((s) => ({ slug: s.slug, name: s.name }))}
      extractionState={extraction.extract_codes}
    />
  );
}
