import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSpecialty } from '@/lib/data/specialties';
import { getTabsComplete } from '@/lib/data/tab-status';
import { RememberSpecialty } from '../_components/remember-specialty';
import { NotConfiguredView, SpecialtyHeader } from '../_components/specialty-header';

export default async function SpecialtyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  // Curriculum plans are managed under their own Content Planner subtab — send
  // old /planning/<slug> links/bookmarks to the curriculum-plans surface.
  const specialty = await getSpecialty(slug);
  if (specialty?.pipelineMode === 'curriculum-mapping') {
    redirect(`/planning/curriculum-plans/${slug}`);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <RememberSpecialty slug={slug} />
      <Suspense fallback={null}>
        <SpecialtyHeaderData slug={slug} />
      </Suspense>
      {children}
    </div>
  );
}

async function SpecialtyHeaderData({ slug }: { slug: string }) {
  const specialty = await getSpecialty(slug);
  if (!specialty) return <NotConfiguredView slug={slug} />;

  const tabsComplete = await getTabsComplete(slug);

  return <SpecialtyHeader specialty={specialty} tabsComplete={tabsComplete} />;
}
