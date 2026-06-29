'use client';

import { Callout, H1, Inline, Stack } from '@amboss/design-system';
import type { Specialty } from '@/lib/types';
import { Breadcrumbs } from './breadcrumbs';
import { ChangeSpecialtyButton } from './change-specialty-button';
import { RefreshButton } from './refresh-button';
import { SpecialtySettingsButton } from './specialty-settings-button';
import { SpecialtyTabs } from './specialty-tabs';

// Tabs hidden for a mapping-only specialty — the consolidation parent and
// everything downstream of suggestions.
const MAPPING_ONLY_HIDDEN_SEGMENTS = ['consolidation-review', 'backlog', 'drift'];

// Which dashboard subtab a specialty belongs to, by pipeline mode — so the
// breadcrumb returns to the tab the specialty lives under instead of the
// default "Full pipeline".
const DASHBOARD_HREF: Record<string, string> = {
  full: '/planning/full-pipeline',
  'rag-corpus': '/planning/rag-corpus',
  'mapping-only': '/planning/mapping',
  'curriculum-mapping': '/planning/curriculum-plans',
};

export function SpecialtyHeader({
  specialty,
  tabsComplete,
}: {
  specialty: Specialty;
  tabsComplete: Record<string, boolean>;
}) {
  const hiddenSegments = specialty.mappingOnly
    ? new Set(MAPPING_ONLY_HIDDEN_SEGMENTS)
    : undefined;
  const dashboardHref =
    DASHBOARD_HREF[specialty.pipelineMode ?? 'full'] ?? '/planning/full-pipeline';
  return (
    <Stack space="l">
      <Breadcrumbs
        crumbs={[
          { label: 'Specialty Dashboard', href: dashboardHref },
          { label: specialty.name },
        ]}
      />
      <Inline space="m" vAlignItems="center">
        <H1>{specialty.name}</H1>
        <ChangeSpecialtyButton />
        <RefreshButton slug={specialty.slug} />
        <SpecialtySettingsButton
          slug={specialty.slug}
          pipelineMode={specialty.pipelineMode ?? 'full'}
          mappingSource={specialty.mappingSource ?? 'amboss'}
          mcpEnv={specialty.mcpEnv ?? 'production'}
        />
      </Inline>
      <SpecialtyTabs
        slug={specialty.slug}
        tabsComplete={tabsComplete}
        hiddenSegments={hiddenSegments}
      />
    </Stack>
  );
}

export function NotConfiguredView({ slug }: { slug: string }) {
  return (
    <Stack space="l">
      <Breadcrumbs
        crumbs={[{ label: 'Specialty Dashboard', href: '/planning' }, { label: slug }]}
      />
      <H1>{slug}</H1>
      <Callout
        type="info"
        text={`"${slug}" is not configured. Add a sheet ID under MAPPING_SHEET_IDS in .env.local (e.g. {"${slug}":"<google-sheet-id>"}) or register a local xlsx via LOCAL_XLSX_FIXTURES, then restart the dev server.`}
      />
    </Stack>
  );
}
