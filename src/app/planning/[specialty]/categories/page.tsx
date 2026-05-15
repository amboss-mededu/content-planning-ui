import { Suspense } from 'react';
import {
  listCategoryOrchestration,
  listSourceCategoryProgress,
} from '@/lib/data/categories';
import { getTabOverrides } from '@/lib/data/specialties';
import { CategoriesView } from '../../_components/categories-view';
import { MarkStepCompleteButton } from '../../_components/mark-step-complete-button';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={7} rows={10} />}>
      <CategoriesData slug={slug} />
    </Suspense>
  );
}

async function CategoriesData({ slug }: { slug: string }) {
  const [rows, sourceRows, overrides] = await Promise.all([
    listCategoryOrchestration(slug),
    listSourceCategoryProgress(slug),
    getTabOverrides(slug),
  ]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CategoriesView rows={rows} sourceRows={sourceRows} slug={slug} />
      <div>
        <MarkStepCompleteButton
          slug={slug}
          segment="categories"
          isComplete={overrides.categories === true}
        />
      </div>
    </div>
  );
}
