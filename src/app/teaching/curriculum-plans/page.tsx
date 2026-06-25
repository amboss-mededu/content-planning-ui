import { Suspense } from 'react';
import { listCurriculumPlansWithStats } from '@/lib/data/curriculum-plans';
import {
  CurriculumPlansSkeleton,
  CurriculumPlansView,
} from '../_components/curriculum-plans-view';

export default function CurriculumPlansPage() {
  return (
    <Suspense fallback={<CurriculumPlansSkeleton />}>
      <CurriculumPlansData />
    </Suspense>
  );
}

async function CurriculumPlansData() {
  const plans = await listCurriculumPlansWithStats();
  return <CurriculumPlansView plans={plans} />;
}
