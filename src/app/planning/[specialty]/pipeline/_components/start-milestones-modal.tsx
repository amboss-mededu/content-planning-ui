'use client';

import { Button, Inline, Modal } from '@amboss/design-system';
import { useState } from 'react';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { RunningButton } from '../../../_components/running-button';
import { RerunExtractionButton } from './rerun-extraction-button';
import { StartMilestonesForm } from './start-milestones-form';

export function StartMilestonesModal({
  specialtySlug,
  sources,
  running,
  completed = false,
  runId = null,
}: {
  specialtySlug: string;
  sources: CodeSource[];
  running: boolean;
  /** Latest extract_milestones run finished — show "Re run extraction". */
  completed?: boolean;
  /** Owning run id of the latest stage — needed to reset on re-run. */
  runId?: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (running) return <RunningButton />;

  return (
    <>
      {completed && runId ? (
        // Milestones is adjacent, not downstream — re-running never wipes the
        // code pipeline, so always the plain single-confirm path.
        <RerunExtractionButton
          specialtySlug={specialtySlug}
          runId={runId}
          stage="extract_milestones"
          hasDownstream={false}
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
          header="Extract milestones"
          subHeader="Provide URLs or upload PDFs to extract milestone documents."
          size="l"
          isDismissible
          initialFocus="[data-modal-close-btn]"
          actionButton={{ text: 'Close', onClick: () => setOpen(false) }}
          onAction={() => setOpen(false)}
        >
          <Modal.Stack>
            <StartMilestonesForm specialtySlug={specialtySlug} sources={sources} />
          </Modal.Stack>
        </Modal>
      ) : null}
    </>
  );
}
