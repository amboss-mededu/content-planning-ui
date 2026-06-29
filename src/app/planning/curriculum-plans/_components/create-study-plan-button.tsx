'use client';

import { Button } from '@amboss/design-system';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { CreateStudyPlanModal } from './create-study-plan-modal';

/**
 * "Create study plan" action that floats to the right of the curriculum plan
 * stepper. Rendered for every sub-page (it sits in the shared header) but only
 * shown on the Overview page — the root segment — using the same pathname parse
 * as `specialty-tabs.tsx`.
 */
export function CreateStudyPlanButton({ slug }: { slug: string }) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  const base = `/planning/curriculum-plans/${slug}`;
  const rest = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, '')
    : '';
  const currentSegment = rest.split('/')[0] ?? '';
  if (currentSegment !== '') return null;

  return (
    <>
      <Button variant="secondary" size="s" leftIcon="plus" onClick={() => setOpen(true)}>
        Create study plan
      </Button>
      <CreateStudyPlanModal slug={slug} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
