/**
 * Deterministic token returned by trigger routes so the UI has a stable
 * value to send back when invoking /api/workflows/approve.
 *
 * Pre-PR-6 this matched the token a paused workflow hook was waiting on.
 * The runtime is gone now — the token is purely an opaque per-stage
 * identifier the UI echoes back; the approve route looks at runId + stage
 * directly to invoke the matching `*Phase2`. We keep it because removing
 * it would change the trigger response shape (and thus client code) for
 * no benefit.
 */

export type ApprovableStage = 'extract_codes' | 'extract_milestones' | 'map_codes';

export type ApprovalPayload = {
  approved: boolean;
  approvedBy?: string;
  note?: string;
};

export function approvalToken(runId: string, stage: ApprovableStage): string {
  return `approve:${runId}:${stage}`;
}
