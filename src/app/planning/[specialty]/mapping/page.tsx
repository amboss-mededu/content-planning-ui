import { Suspense } from 'react';
import { deriveCodeCategories, listCodes, listInFlightCodes } from '@/lib/data/codes';
import { getConsolidationLockState } from '@/lib/data/pipeline';
import { TableSkeleton } from '../../_components/table-skeleton';
import { CodesViewClient } from './codes-view-client';

export default async function CodesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;

  return (
    <Suspense fallback={<TableSkeleton columns={7} rows={15} />}>
      <CodesPageData slug={slug} />
    </Suspense>
  );
}

async function CodesPageData({ slug }: { slug: string }) {
  // RSC fetches the snapshot; the client hook subscribes to PB live updates.
  const [lock, codes, inFlight] = await Promise.all([
    getConsolidationLockState(slug),
    listCodes(slug),
    listInFlightCodes(slug),
  ]);

  // Derive other views in-memory from the codes array to avoid redundant full-table queries
  const categories = deriveCodeCategories(codes);

  const unmappedPicker = codes
    .filter((r) => !r.mappedAt || r.mappedAt === 0)
    .map((r) => ({
      code: r.code,
      description: r.description ?? null,
      category: r.category ?? null,
    }));

  const unmappedCount = codes.filter((r) => !r.mappedAt || r.mappedAt === 0).length;

  return (
    <CodesViewClient
      slug={slug}
      canEdit={!lock.locked}
      lockStatus={lock.status}
      initialCodes={codes}
      initialInFlight={inFlight}
      categories={categories}
      unmappedCodes={unmappedPicker}
      unmappedCount={unmappedCount}
    />
  );
}
