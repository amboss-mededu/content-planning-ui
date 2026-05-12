import { Suspense } from 'react';
import { getOverviewCounts } from '@/lib/data/overview';
import { getSpecialty, getTabOverrides } from '@/lib/data/specialties';
import { MarkStepCompleteButton } from '../_components/mark-step-complete-button';
import { OverviewSkeleton } from '../_components/overview-skeleton';
import { OverviewView } from '../_components/overview-view';

export default async function SpecialtyOverview({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewData slug={slug} />
    </Suspense>
  );
}

async function OverviewData({ slug }: { slug: string }) {
  const specialty = await getSpecialty(slug);
  if (!specialty) return null;

  const [counts, overrides] = await Promise.all([
    getOverviewCounts(slug),
    getTabOverrides(slug),
  ]);

  const statItems = [
    { label: 'Codes', value: counts.codes, hint: `${counts.mappedCodes} mapped` },
    { label: 'Categories', value: counts.categories },
    {
      label: 'Consolidated articles',
      value: counts.consolidatedArticles,
      hint: `${counts.newArticles} new suggestions`,
    },
    { label: 'Consolidated sections', value: counts.consolidatedSections },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <OverviewView stats={statItems} />
      <div>
        <MarkStepCompleteButton
          slug={slug}
          segment=""
          isComplete={overrides[''] === true}
        />
      </div>
    </div>
  );
}
