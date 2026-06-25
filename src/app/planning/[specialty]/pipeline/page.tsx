import { Suspense } from 'react';
import { PipelineDashboardData } from '../../_components/pipeline-dashboard-data';
import { SkeletonLine } from '../../_components/skeleton';

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<PipelineSkeleton />}>
      <PipelineDashboardData slug={slug} />
    </Suspense>
  );
}

function PipelineSkeleton() {
  const cards = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {cards.map((k) => (
        <div
          key={k}
          style={{
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: '#fff',
          }}
        >
          <SkeletonLine width={'30%'} height={18} />
          <SkeletonLine width={'70%'} height={12} />
          <SkeletonLine width={'50%'} height={12} />
        </div>
      ))}
    </div>
  );
}
