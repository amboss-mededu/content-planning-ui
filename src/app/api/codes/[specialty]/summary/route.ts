import { NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import {
  listCodeCount,
  listInFlightCodes,
  listUnmappedCodeCount,
} from '@/lib/data/codes';
import { getConsolidationLockState } from '@/lib/data/pipeline';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);

  const [totalCount, unmappedCount, inFlightCodes, lock] = await Promise.all([
    listCodeCount(slug),
    listUnmappedCodeCount(slug),
    listInFlightCodes(slug),
    getConsolidationLockState(slug),
  ]);

  return NextResponse.json({ totalCount, unmappedCount, inFlightCodes, lock });
}
