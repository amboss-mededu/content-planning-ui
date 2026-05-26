import { Suspense } from 'react';
import { listCodeTableRowsPage } from '@/lib/data/codes';
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
  const firstPage = await listCodeTableRowsPage(slug, 1, 200);

  return (
    <CodesViewClient
      slug={slug}
      initialCodes={firstPage.items}
      initialHasMore={firstPage.hasMore}
    />
  );
}
