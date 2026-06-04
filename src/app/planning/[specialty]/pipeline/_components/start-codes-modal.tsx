'use client';

import { Button, Inline, Modal } from '@amboss/design-system';
import { useState } from 'react';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { RunningButton } from '../../../_components/running-button';
import { RerunExtractionButton } from './rerun-extraction-button';
import { StartRunForm } from './start-run-form';

export function StartCodesModal({
  specialtySlug,
  sources,
  running,
  completed = false,
  hasDownstream = false,
  runId = null,
}: {
  specialtySlug: string;
  sources: CodeSource[];
  running: boolean;
  /** Latest extract_codes run finished — show "Re run extraction" instead. */
  completed?: boolean;
  /** Mapping has run, so a re-run must wipe downstream (typed confirm). */
  hasDownstream?: boolean;
  /** Owning run id of the latest stage — needed to reset on re-run. */
  runId?: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (running) return <RunningButton />;

  return (
    <>
      {completed && runId ? (
        <RerunExtractionButton
          specialtySlug={specialtySlug}
          runId={runId}
          stage="extract_codes"
          hasDownstream={hasDownstream}
          onResetComplete={() => setOpen(true)}
        />
      ) : (
        <Inline space="s">
          <div style={{ width: 220 }}>
            <Button onClick={() => setOpen(true)} fullWidth>
              Start extraction
            </Button>
          </div>
        </Inline>
      )}
      {open ? (
        <Modal
          header="Extract codes"
          subHeader="Provide URLs or upload PDFs to extract curriculum codes."
          size="l"
          isDismissible
          initialFocus="[data-modal-close-btn]"
          actionButton={{ text: 'Close', onClick: () => setOpen(false) }}
          onAction={() => setOpen(false)}
        >
          <Modal.Stack>
            <StartRunForm specialtySlug={specialtySlug} sources={sources} />
          </Modal.Stack>
        </Modal>
      ) : null}
    </>
  );
}
