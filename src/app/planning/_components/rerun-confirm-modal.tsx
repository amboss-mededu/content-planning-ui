'use client';

import { Modal, Stack, Textarea } from '@amboss/design-system';
import { useEffect, useState } from 'react';

const MAX_EDITOR_NOTE_LENGTH = 4000;

export function RerunConfirmModal({
  open,
  category,
  hasOutput,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  category: string;
  /** True when the bucket already has consolidated output. Drives copy
   *  ("Re-run" vs "Run") and whether the editor-comment textarea is
   *  shown. First-runs are simple acknowledgements. */
  hasOutput: boolean;
  /** Receives the trimmed editor note (or `null` if empty/first-run). */
  onConfirm: (editorNote: string | null) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');

  // Reset the textarea every time the modal re-opens so a stale note
  // from a previous category isn't carried over.
  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  if (!open) return null;

  const verb = hasOutput ? 'Re-run' : 'Run';
  const header = `${verb} consolidation`;
  const bodyText = hasOutput
    ? `This replaces the consolidation suggestions for "${category}" with a fresh result. Approvals, sources, and drafts re-attach to articles the re-run reproduces; anything it no longer produces is flagged for review, not deleted.`
    : `Run consolidation for "${category}".`;
  const trimmed = note.trim();
  const errorMessages =
    trimmed.length > MAX_EDITOR_NOTE_LENGTH
      ? [`Keep instructions under ${MAX_EDITOR_NOTE_LENGTH} characters.`]
      : undefined;
  const canConfirm = !errorMessages;

  return (
    <Modal
      header={header}
      subHeader={category}
      size="m"
      isDismissible
      role={hasOutput ? 'dialog' : 'alertdialog'}
      actionButton={{
        // No longer destructive: a re-run preserves approvals/sources and
        // only flags orphaned items, so it reads as a normal action.
        text: verb,
        onClick: () => onConfirm(trimmed.length > 0 ? trimmed : null),
        disabled: !canConfirm,
      }}
      secondaryButton={{
        text: 'Cancel',
        onClick: onCancel,
      }}
      onAction={(action) => {
        if (action === 'cancel') onCancel();
      }}
      closeButtonAriaLabel="Close re-run consolidation dialog"
    >
      <Modal.Stack>
        <Stack space="s">
          <Modal.Text>{bodyText}</Modal.Text>
          {hasOutput ? (
            <Textarea
              label="Additional instructions for this re-run (optional)"
              hint="Anything typed here is sent to the model as editor instructions for this run only."
              hideLabel={false}
              rows={4}
              resize="vertical"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              errorMessages={errorMessages}
              hasError={Boolean(errorMessages)}
            />
          ) : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
