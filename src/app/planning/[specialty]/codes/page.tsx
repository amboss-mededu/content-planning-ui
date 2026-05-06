import {
  getConsolidationLockState,
  listCodes,
  listInFlightCodes,
} from '@/lib/data/codes';
import { CodesViewClient } from './codes-view-client';

export default async function CodesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;

  // RSC fetches the snapshot; the client hook subscribes to PB live updates.
  // The consolidation lock still bridges to Convex pipeline state until PR 5.
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
