import { NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import {
  listCodeCount,
  listInFlightCodes,
  listUnmappedCodeCount,
} from '@/lib/data/codes';
import { getConsolidationActivity } from '@/lib/data/pipeline';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);

  const [totalCount, unmappedCount, inFlightCodes, activity] = await Promise.all([
    listCodeCount(slug),
    listUnmappedCodeCount(slug),
    listInFlightCodes(slug),
    getConsolidationActivity(slug),
  ]);

  return NextResponse.json({ totalCount, unmappedCount, inFlightCodes, activity });
}
