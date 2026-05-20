import { NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { getMapCodesHistory } from '@/lib/data/pipeline';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);
  const history = await getMapCodesHistory(slug);
  return NextResponse.json(history);
}
