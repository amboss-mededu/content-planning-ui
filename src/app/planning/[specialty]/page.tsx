import { Suspense } from 'react';
import { getOverviewCounts } from '@/lib/data/overview';
import { getPipelineStageStates, getSpecialty } from '@/lib/data/specialties';
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

  const [counts, stageStates] = await Promise.all([
    getOverviewCounts(slug),
    getPipelineStageStates(slug),
  ]);
  const base = `/planning/${slug}`;

  const statItems = [
    {
      label: 'Codes',
      value: counts.codes,
      hint: `${counts.mappedCodes} mapped`,
      href: `${base}/mapping`,
    },
    {
      label: 'Categories',
      value: counts.sourceCategories,
      hint: `${counts.consolidationCategories} consolidation categories`,
      href: `${base}/categories`,
    },
    {
      label: 'New articles',
      value: counts.newArticles,
      hint: `${counts.newArticlesApproved} approved`,
      href: `${base}/articles?pass=second`,
    },
    {
      label: 'Article updates',
      value: counts.articlesWithUpdates,
      hint: `${counts.sectionsApproved} sections approved across ${counts.articlesWithApprovedSections} articles`,
      href: `${base}/sections?grouping=article`,
    },
  ];

  return <OverviewView stats={statItems} stageStates={stageStates} />;
}
