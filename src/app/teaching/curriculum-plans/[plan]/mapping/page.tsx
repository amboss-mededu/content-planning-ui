import { Suspense } from 'react';
import { MappingData } from '@/app/planning/_components/mapping-data';
import { TableSkeleton } from '@/app/planning/_components/table-skeleton';

export default async function CurriculumMappingPage({
  params,
}: {
  params: Promise<{ plan: string }>;
}) {
  const { plan: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={7} rows={15} />}>
      <MappingData slug={slug} />
    </Suspense>
  );
}
