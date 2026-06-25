import { Suspense } from 'react';
import { MappingData } from '../../_components/mapping-data';
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
