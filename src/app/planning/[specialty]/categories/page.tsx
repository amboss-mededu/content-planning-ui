import { Suspense } from 'react';
import {
  listCategoryOrchestration,
  listSourceCategoryProgress,
} from '@/lib/data/categories';
import { listCodeSources } from '@/lib/data/code-sources';
import { listCodeCount } from '@/lib/data/codes';
import { getExtractionRunning } from '@/lib/data/pipeline';
import { CategoriesView } from '../../_components/categories-view';
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
  const [rows, sourceRows, codeSources, codeCount, running] = await Promise.all([
    listCategoryOrchestration(slug),
    listSourceCategoryProgress(slug),
    listCodeSources(),
    listCodeCount(slug),
    getExtractionRunning(slug),
  ]);
  return (
    <CategoriesView
      rows={rows}
      sourceRows={sourceRows}
      slug={slug}
      codeSources={codeSources.map((s) => ({ slug: s.slug, name: s.name }))}
      codeCount={codeCount}
      extractionRunning={running.extract_codes}
    />
  );
}
