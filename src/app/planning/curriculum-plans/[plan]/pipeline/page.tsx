import { Suspense } from 'react';
import { PipelineDashboardData } from '@/app/planning/_components/pipeline-dashboard-data';

export default async function CurriculumPipelinePage({
  params,
}: {
  params: Promise<{ plan: string }>;
}) {
  const { plan: slug } = await params;
  return (
    <Suspense fallback={null}>
      <PipelineDashboardData slug={slug} basePath="/planning/curriculum-plans" />
    </Suspense>
  );
}
