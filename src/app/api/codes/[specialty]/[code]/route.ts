/**
 * Per-code edit endpoint.
 *
 * PATCH /api/codes/[specialty]/[code]
 *   body: strict — scalar metadata/coverage fields plus the three JSON
 *   suggestion arrays (full replacements). See `lib/validation/code-patch.ts`.
 *
 * The mapping sheet is always editable; an edit is rejected with 409 only when
 * the code's consolidation bucket (or the whole specialty) is actively
 * rebuilding. A bucket move is checked against BOTH the origin and destination
 * bucket so a code can't be moved out of, or into, a running bucket.
 * Returns the updated row so the client can merge it into local table state.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { ClientResponseError } from 'pocketbase';
import { getCurrentUser, requireUserResponse } from '@/lib/auth';
import { getCode, type PatchCodeFields, patchCode } from '@/lib/data/codes';
import { getConsolidationActivity, isBucketEditBlocked } from '@/lib/data/pipeline';
import { errorMessage } from '@/lib/error-message';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { CodePatchBody, type CodePatchInput } from '@/lib/validation/code-patch';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ specialty: string; code: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty, code } = await params;
  const slug = decodeURIComponent(specialty);
  const codeId = decodeURIComponent(code);

  const row = await getCode(slug, codeId);
  if (!row) return NextResponse.json({ error: 'code not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ specialty: string; code: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty, code } = await params;
  const slug = decodeURIComponent(specialty);
  const codeId = decodeURIComponent(code);

  const body = await parseBodyOr400(req, CodePatchBody);
  if (body instanceof NextResponse) return body;

  const fields = toPatchFields(body);
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'no editable fields supplied' }, { status: 400 });
  }

  // Block only when this code's bucket is actively rebuilding. A bucket move is
  // gated against the origin (current bucket) and the destination.
  const [activity, current] = await Promise.all([
    getConsolidationActivity(slug),
    getCode(slug, codeId),
  ]);
  const blockedBucket = [
    current?.consolidationCategory,
    fields.consolidationCategory,
  ].find((b) => !activity.runningAll && isBucketEditBlocked(activity, b));
  if (activity.runningAll || blockedBucket !== undefined) {
    const label = activity.runningAll
      ? 'A full consolidation'
      : `Consolidation for "${blockedBucket}"`;
    return NextResponse.json(
      { error: `${label} is running — codes will be editable again shortly.` },
      { status: 409 },
    );
  }
  log('codes').info('PATCH', { slug, code: codeId, fields: Object.keys(fields) });

  try {
    // Reviewer email is stamped server-side for the curriculum approval gate.
    const reviewer =
      fields.curriculumReviewStatus !== undefined
        ? ((await getCurrentUser())?.email ?? null)
        : null;
    const updated = await patchCode(slug, codeId, fields, reviewer);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      return NextResponse.json({ error: 'code not found' }, { status: 404 });
    }
    const msg = errorMessage(e);
    log('codes').error('PATCH failed:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Project the validated body onto `PatchCodeFields`. Scalar strings are trimmed
 * (an empty string is forwarded so an editor can clear a field). Arrays, the
 * enum, the number, and the boolean pass through as-is. Keys absent from the
 * body stay absent from the update.
 */
function toPatchFields(body: CodePatchInput): PatchCodeFields {
  const out: PatchCodeFields = {};
  if (body.source !== undefined) out.source = body.source.trim();
  if (body.description !== undefined) out.description = body.description.trim();
  if (body.category !== undefined) out.category = body.category.trim();
  if (body.consolidationCategory !== undefined)
    out.consolidationCategory = body.consolidationCategory.trim();
  if (body.isInAMBOSS !== undefined) out.isInAMBOSS = body.isInAMBOSS;
  if (body.coverageLevel !== undefined) out.coverageLevel = body.coverageLevel;
  if (body.depthOfCoverage !== undefined) out.depthOfCoverage = body.depthOfCoverage;
  if (body.notes !== undefined) out.notes = body.notes.trim();
  if (body.gaps !== undefined) out.gaps = body.gaps.trim();
  if (body.improvements !== undefined) out.improvements = body.improvements.trim();
  if (body.articlesWhereCoverageIs !== undefined)
    out.articlesWhereCoverageIs = body.articlesWhereCoverageIs;
  if (body.existingArticleUpdates !== undefined)
    out.existingArticleUpdates = body.existingArticleUpdates;
  if (body.newArticlesNeeded !== undefined)
    out.newArticlesNeeded = body.newArticlesNeeded;
  if (body.curriculumReviewStatus !== undefined)
    out.curriculumReviewStatus = body.curriculumReviewStatus;
  return out;
}
