import { NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { getAmbossLibraryStats } from '@/lib/data/amboss-library';
import { listCodeCategories, listUnmappedCodesForPicker } from '@/lib/data/codes';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);

  const [libraryStats, categories, unmappedCodes] = await Promise.all([
    getAmbossLibraryStats(),
    listCodeCategories(slug),
    listUnmappedCodesForPicker(slug),
  ]);

  return NextResponse.json({ libraryStats, categories, unmappedCodes });
}
