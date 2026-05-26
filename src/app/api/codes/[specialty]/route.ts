import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { listCodeTableRowsPage } from '@/lib/data/codes';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);

  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const perPage = Math.min(
    500,
    Math.max(1, Number(req.nextUrl.searchParams.get('perPage')) || 200),
  );
  const updatedAfter = req.nextUrl.searchParams.get('updatedAfter');
  const result = await listCodeTableRowsPage(slug, page, perPage, updatedAfter);
  return NextResponse.json(result);
}
