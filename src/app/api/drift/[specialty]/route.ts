/**
 * Open drift impacts for one specialty — the join of open CMS change
 * events against this specialty's codes / consolidated articles+sections /
 * update backlog. Drives the drift queue badges on the client.
 *
 * GET /api/drift/[specialty]
 *   → 200 { impacts: DriftImpact[] }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { getDriftImpacts } from '@/lib/data/content-drift';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  try {
    const impacts = await getDriftImpacts(specialty);
    return NextResponse.json({ impacts });
  } catch (err) {
    log('drift-impacts').error('failed', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
