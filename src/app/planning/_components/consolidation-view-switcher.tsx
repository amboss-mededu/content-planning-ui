'use client';

import { SegmentedControl } from '@amboss/design-system';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Three-way switcher that lives at the top of each of the three
 * "1st consolidation" surfaces (consolidation-review, articles,
 * sections). Mirrors the existing SegmentedControl pattern used inside
 * articles-view, but drives navigation between routes rather than
 * switching state inside a single page.
 *
 * The top nav has a single "1st consolidation" entry; this is the
 * secondary nav inside that cluster.
 */
export function ConsolidationViewSwitcher({ slug }: { slug: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const base = `/planning/${slug}`;
  const segment = pathname.startsWith(base)
    ? (pathname.slice(base.length).replace(/^\//, '').split('/')[0] ?? '')
    : '';
  const value: 'review' | 'articles' | 'sections' =
    segment === 'articles' ? 'articles' : segment === 'sections' ? 'sections' : 'review';

  return (
    <SegmentedControl
      label="Consolidation view"
      isLabelHidden
      value={value}
      onChange={(v) => {
        const target =
          v === 'articles'
            ? 'articles'
            : v === 'sections'
              ? 'sections'
              : 'consolidation-review';
        router.push(`${base}/${target}`);
      }}
      options={[
        { name: 'consolidation-view', value: 'review', label: 'Review' },
        { name: 'consolidation-view', value: 'articles', label: 'New articles' },
        { name: 'consolidation-view', value: 'sections', label: 'Article updates' },
      ]}
    />
  );
}
