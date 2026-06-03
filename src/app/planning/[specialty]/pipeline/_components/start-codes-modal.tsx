'use client';

import { Button, Inline, Modal } from '@amboss/design-system';
import { useState } from 'react';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { RunningButton } from '../../../_components/running-button';
import { StartRunForm } from './start-run-form';

export function StartCodesModal({
  specialtySlug,
  sources,
  running,
}: {
  specialtySlug: string;
  sources: CodeSource[];
  running: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (running) return <RunningButton />;

  return (
    <>
      <Inline space="s">
        <div style={{ width: 220 }}>
          <Button onClick={() => setOpen(true)} fullWidth>
            Start extraction
          </Button>
        </div>
      </Inline>
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
