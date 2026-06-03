import { Suspense } from 'react';
import { listMilestoneSources } from '@/lib/data/milestone-sources';
import { getExtractionRunning } from '@/lib/data/pipeline';
import { getMilestones } from '@/lib/data/specialties';
import { MilestonesView } from '../../_components/milestones-view';
import { SkeletonLine } from '../../_components/skeleton';

export default async function MilestonesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<MilestonesSkeleton />}>
      <MilestonesData slug={slug} />
    </Suspense>
  );
}

async function MilestonesData({ slug }: { slug: string }) {
  const [milestones, milestoneSources, running] = await Promise.all([
    getMilestones(slug),
    listMilestoneSources(),
    getExtractionRunning(slug),
  ]);
  return (
    <MilestonesView
      milestones={milestones}
      specialtySlug={slug}
      sources={milestoneSources.map((s) => ({ slug: s.slug, name: s.name }))}
      extractionRunning={running.extract_milestones}
    />
  );
}

function MilestonesSkeleton() {
  const lines = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {lines.map((k) => (
        <SkeletonLine key={k} width={`${60 + ((parseInt(k.slice(1), 10) * 7) % 35)}%`} />
      ))}
    </div>
  );
}
