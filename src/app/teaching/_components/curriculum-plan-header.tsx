'use client';

import { H1, Stack } from '@amboss/design-system';
import type { ReactNode } from 'react';
import { Breadcrumbs } from '../../planning/_components/breadcrumbs';

const BASE_PATH = '/teaching/curriculum-plans';

// Client boundary for the curriculum plan header. The DS package ships without
// "use client", so any file rendering its components must be a client module —
// the server layout delegates here and streams the tab bar in via `children`.
export function CurriculumPlanHeader({
  name,
  children,
}: {
  name: string;
  children?: ReactNode;
}) {
  return (
    <Stack space="l">
      <Breadcrumbs
        crumbs={[{ label: 'Curriculum Plans', href: BASE_PATH }, { label: name }]}
      />
      <H1>{name}</H1>
      {children}
    </Stack>
  );
}
