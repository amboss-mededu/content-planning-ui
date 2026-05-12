'use client';

import { Badge, Callout, H1, Inline, Stack, Text } from '@amboss/design-system';
import { PHASE_COLOR, PHASE_LABEL, type Phase } from '@/lib/phase';
import type { Specialty } from '@/lib/types';
import { Breadcrumbs } from './breadcrumbs';
import { ChangeSpecialtyButton } from './change-specialty-button';
import { RefreshButton } from './refresh-button';
import { SpecialtyTabs } from './specialty-tabs';

export function SpecialtyHeader({
  specialty,
  phase,
  tabsComplete,
}: {
  specialty: Specialty;
  phase: Phase;
  tabsComplete: Record<string, boolean>;
}) {
  return (
    <Stack space="l">
      <Breadcrumbs
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Specialty Dashboard', href: '/planning' },
          { label: specialty.name },
        ]}
      />
      <Inline space="m" vAlignItems="center">
        <H1>{specialty.name}</H1>
        <Badge text={PHASE_LABEL[phase]} color={PHASE_COLOR[phase]} />
        <ChangeSpecialtyButton />
        <RefreshButton slug={specialty.slug} />
      </Inline>
      <Text color="secondary">
        Slug: <code>{specialty.slug}</code>
      </Text>
      <SpecialtyTabs slug={specialty.slug} tabsComplete={tabsComplete} />
    </Stack>
  );
}

export function NotConfiguredView({ slug }: { slug: string }) {
  return (
    <Stack space="l">
      <Breadcrumbs
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Specialty Dashboard', href: '/planning' },
          { label: slug },
        ]}
      />
      <H1>{slug}</H1>
      <Callout
        type="info"
        text={`"${slug}" is not configured. Add a sheet ID under MAPPING_SHEET_IDS in .env.local (e.g. {"${slug}":"<google-sheet-id>"}) or register a local xlsx via LOCAL_XLSX_FIXTURES, then restart the dev server.`}
      />
    </Stack>
  );
}
