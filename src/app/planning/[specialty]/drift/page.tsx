import { Suspense } from 'react';
import { getDriftImpacts } from '@/lib/data/content-drift';
import { isStubContentChangeFeed } from '@/lib/integrations/content-change-feed';
import { TableSkeleton } from '../../_components/table-skeleton';
import { DriftQueueView } from './_components/drift-queue-view';

export default async function DriftPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={3} rows={6} />}>
      <DriftData slug={slug} />
    </Suspense>
  );
}

async function DriftData({ slug }: { slug: string }) {
  const impacts = await getDriftImpacts(slug);
  return <DriftQueueView impacts={impacts} feedConfigured={!isStubContentChangeFeed()} />;
}
