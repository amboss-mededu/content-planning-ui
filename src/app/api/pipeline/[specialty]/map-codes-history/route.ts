import { NextResponse } from 'next/server';
import { requireArchitectResponse } from '@/lib/auth';
import { getMapCodesHistory } from '@/lib/data/pipeline';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireArchitectResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);
  const history = await getMapCodesHistory(slug);
  return NextResponse.json(history);
}
