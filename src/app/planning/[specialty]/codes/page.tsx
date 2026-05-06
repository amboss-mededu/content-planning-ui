import { listCodes, listInFlightCodes } from '@/lib/data/codes';
import { getConsolidationLockState } from '@/lib/data/pipeline';
import { CodesViewClient } from './codes-view-client';

export default async function CodesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;

  // RSC fetches the snapshot; the client hook subscribes to PB live updates.
  const [lock, codes, inFlight] = await Promise.all([
    getConsolidationLockState(slug),
    listCodes(slug),
    listInFlightCodes(slug),
  ]);

  return (
    <CodesViewClient
      slug={slug}
      canEdit={!lock.locked}
      lockStatus={lock.status}
      initialCodes={codes}
      initialInFlight={inFlight}
    />
  );
}
