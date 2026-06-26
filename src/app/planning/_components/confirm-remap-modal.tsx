'use client';

import { Modal } from '@amboss/design-system';

/**
 * Confirmation gate before a category remap. A remap clears the existing
 * coverage for the approved, already-mapped codes and re-runs mapping for
 * them, so it must be acknowledged first. Approvals are preserved — only
 * coverage results are replaced. Pattern mirrors `rerun-confirm-modal.tsx`.
 */
export function ConfirmRemapModal({
  open,
  category,
  count,
  submitting,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  category: string;
  /** How many approved, mapped codes will be cleared and re-mapped. */
  count: number;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Modal
      header="Remap this category?"
      subHeader={category}
      size="m"
      isDismissible
      role="alertdialog"
      actionButton={{
        text: submitting ? 'Remapping…' : 'Remap',
        onClick: onConfirm,
        disabled: submitting,
        destructive: true,
      }}
      secondaryButton={{
        text: 'Cancel',
        onClick: onCancel,
      }}
      onAction={(action) => {
        if (action === 'cancel') onCancel();
      }}
      closeButtonAriaLabel="Close remap confirmation"
    >
      <Modal.Text>
        This clears the existing mapping for the {count} approved, mapped code
        {count === 1 ? '' : 's'} in “{category}” and re-runs mapping for them. Approvals
        are kept; coverage results are replaced.
      </Modal.Text>
    </Modal>
  );
}
