'use client';

// Shared approve/reject controls + row tint for per-item review surfaces.
// Ported from the consolidation review view so the curriculum-mapping approval
// gate (codes table left column + detail modal) renders identically. A `''`
// status means undecided/pending.

import type { CSSProperties } from 'react';
import { APPROVED_TINT, REJECTED_TINT } from './review-tints';

export type DecisionStatus = 'approved' | 'rejected';

export const decisionButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 4,
  border: '1px solid rgba(0, 0, 0, 0.15)',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
};

/** Row background overlay for a review status, or undefined when pending. */
export function rowTint(
  status: DecisionStatus | '' | undefined,
): CSSProperties | undefined {
  if (status === 'approved') return { background: APPROVED_TINT };
  if (status === 'rejected') return { background: REJECTED_TINT };
  return undefined;
}

function decisionButton(active: boolean, kind: DecisionStatus): CSSProperties {
  if (!active) return decisionButtonBase;
  if (kind === 'approved') {
    return {
      ...decisionButtonBase,
      background: 'rgb(16, 185, 129)',
      borderColor: 'rgb(16, 185, 129)',
      color: '#fff',
    };
  }
  return {
    ...decisionButtonBase,
    background: 'rgb(220, 38, 38)',
    borderColor: 'rgb(220, 38, 38)',
    color: '#fff',
  };
}

/**
 * Approve (✓) / Reject (✗) buttons. Clicking the active decision clears it back
 * to pending (`onDecide(null)`). Buttons `stopPropagation` so they never bubble
 * to a parent row click (which would open the detail modal).
 */
export function DecisionButtons({
  status,
  disabled = false,
  approveTitle = 'Approve',
  rejectTitle = 'Reject',
  onDecide,
}: {
  status: DecisionStatus | '' | undefined;
  disabled?: boolean;
  approveTitle?: string;
  rejectTitle?: string;
  onDecide: (status: DecisionStatus | null) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <button
        type="button"
        title={status === 'approved' ? `${approveTitle} — click to clear` : approveTitle}
        style={decisionButton(status === 'approved', 'approved')}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onDecide(status === 'approved' ? null : 'approved');
        }}
      >
        ✓
      </button>
      <button
        type="button"
        title={status === 'rejected' ? `${rejectTitle} — click to clear` : rejectTitle}
        style={decisionButton(status === 'rejected', 'rejected')}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onDecide(status === 'rejected' ? null : 'rejected');
        }}
      >
        ✗
      </button>
    </div>
  );
}
