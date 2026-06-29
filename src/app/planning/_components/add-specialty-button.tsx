'use client';

import { Button } from '@amboss/design-system';
import { useState } from 'react';
import type { PipelineMode } from '@/lib/types';
import { AddSpecialtyModal } from './add-specialty-modal';

/** Small "Add specialty" button (sits next to the Specialties header) that
 *  opens the registration modal. The new specialty inherits the pipeline mode
 *  of the dashboard subtab it was opened from. */
export function AddSpecialtyButton({ mode }: { mode: PipelineMode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="s" leftIcon="plus" onClick={() => setOpen(true)}>
        Add specialty
      </Button>
      <AddSpecialtyModal pipelineMode={mode} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
