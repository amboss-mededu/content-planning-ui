'use client';

import { Button } from '@amboss/design-system';
import { useState } from 'react';
import { AddCurriculumPlanModal } from './add-curriculum-plan-modal';

/** "Add curriculum plan" button (sits next to the Curriculum Plans header)
 *  that opens the registration modal. */
export function AddCurriculumPlanButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="s" leftIcon="plus" onClick={() => setOpen(true)}>
        Add curriculum plan
      </Button>
      <AddCurriculumPlanModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
