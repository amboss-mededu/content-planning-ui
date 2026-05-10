'use client';

import { Tabs } from '@amboss/design-system';
import { usePathname, useRouter } from 'next/navigation';

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Pipeline', segment: 'pipeline' },
  { label: 'Codes', segment: 'codes' },
  { label: 'Milestones', segment: 'milestones' },
  { label: 'Categories', segment: 'categories' },
  { label: 'New Articles', segment: 'articles' },
  { label: 'Article Updates', segment: 'sections' },
  { label: 'Sources', segment: 'sources' },
] as const;

export function SpecialtyTabs({ slug }: { slug: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const base = `/planning/${slug}`;
  const rest = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, '')
    : '';
  const currentSegment = rest.split('/')[0] ?? '';
  const activeTab = Math.max(
    0,
    TABS.findIndex((t) => t.segment === currentSegment),
  );

  return (
    <Tabs
      aria-label={`${slug} sections`}
      tabPanelId={`planning-${slug}-panel`}
      activeTab={activeTab}
      tabs={TABS.map((t) => ({ label: t.label }))}
      onTabSelect={(i: number) => {
        const tab = TABS[i];
        if (!tab) return;
        router.push(tab.segment ? `${base}/${tab.segment}` : base);
      }}
    />
  );
}
