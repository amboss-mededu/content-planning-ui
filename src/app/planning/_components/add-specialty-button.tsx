'use client';

import { Button } from '@amboss/design-system';
import { useState } from 'react';
import { AddSpecialtyModal } from './add-specialty-modal';

/** Small "Add specialty" button (sits next to the Specialties header) that
 *  opens the registration modal. */
export function AddSpecialtyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="s" leftIcon="plus" onClick={() => setOpen(true)}>
        Add specialty
      </Button>
      <AddSpecialtyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
