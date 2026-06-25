'use client';

import { Stack, Tabs } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import type { CoverageStats } from '@/lib/data/coverage-stats-compute';
import type { CurriculumPlanStats } from '@/lib/data/curriculum-plans';
import type { CodeRecord, StudyPlanRecord } from '@/lib/pb/types';
import { CoverageStats as StatTiles } from '../../planning/_components/coverage-stats';
import { CurriculumCoverageStatistics } from './curriculum-coverage-statistics';
import { CurriculumGapReportView } from './curriculum-gap-report-view';
import { curriculumStatTiles } from './curriculum-overview-view';
import { CurriculumReviewNotesView } from './curriculum-review-notes-view';
import { CurriculumStructure } from './curriculum-structure';
import { CurriculumStudyPlansView } from './curriculum-study-plans-view';
import { CurriculumTimelineView } from './curriculum-timeline-view';

/**
 * Post-mapping analytics surface for a curriculum plan. The headline stat tiles
 * and the coverage-stats panel stay pinned above an in-page tab sub-navigation
 * (the same DS `Tabs` the code-detail modal uses) switching between four
 * read-only views over the already-fetched codes — no view issues its own query.
 * The active tab is mirrored to `?view=` for deep-linking.
 */

type DashboardView = 'structure' | 'timeline' | 'gaps' | 'review' | 'plans';

const VIEW_TABS: { view: DashboardView; label: string }[] = [
  { view: 'structure', label: 'Curriculum structure' },
  { view: 'timeline', label: 'Timeline' },
  { view: 'gaps', label: 'Gap Report' },
  { view: 'review', label: 'Review Notes' },
  { view: 'plans', label: 'Study Plans' },
];

const DEFAULT_VIEW: DashboardView = 'structure';

function paramToView(param: string | null): DashboardView {
  return VIEW_TABS.find((t) => t.view === param)?.view ?? DEFAULT_VIEW;
}

function viewToIndex(view: DashboardView): number {
  const i = VIEW_TABS.findIndex((t) => t.view === view);
  return i === -1 ? 0 : i;
}

export function CurriculumDashboard({
  slug,
  stats,
  coverageStats,
  codes,
  studyPlans,
}: {
  slug: string;
  stats: CurriculumPlanStats;
  coverageStats: CoverageStats;
  codes: CodeRecord[];
  studyPlans: StudyPlanRecord[];
}) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<DashboardView>(() =>
    paramToView(searchParams?.get('view') ?? null),
  );

  // Mirror the active view into `?view=` without navigating. `router.replace`
  // would trigger an RSC refetch + server re-render under Cache Components, so
  // we follow the `consolidation-review-view.tsx` history.replaceState pattern.
  // The URL stays bare on the default (Curriculum structure) view.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = new URLSearchParams(window.location.search);
    if (view === DEFAULT_VIEW) {
      if (!next.has('view')) return;
      next.delete('view');
    } else {
      if (next.get('view') === view) return;
      next.set('view', view);
    }
    const qs = next.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [view]);

  let body: ReactNode;
  switch (view) {
    case 'timeline':
      body = <CurriculumTimelineView codes={codes} />;
      break;
    case 'gaps':
      body = <CurriculumGapReportView slug={slug} codes={codes} />;
      break;
    case 'review':
      body = <CurriculumReviewNotesView codes={codes} />;
      break;
    case 'plans':
      body = (
        <CurriculumStudyPlansView
          slug={slug}
          codes={codes}
          initialStudyPlans={studyPlans}
        />
      );
      break;
    default:
      body = <CurriculumStructure codes={codes} />;
  }

  return (
    <Stack space="xl">
      <StatTiles stats={curriculumStatTiles(stats)} />
      <CurriculumCoverageStatistics
        coverageStats={coverageStats}
        questions={{ total: stats.totalQuestions, unique: stats.uniqueQuestions }}
      />
      <div className="curriculum-tabs">
        <Tabs
          aria-label="Curriculum analytics views"
          tabPanelId="curriculum-dashboard-panel"
          activeTab={viewToIndex(view)}
          onTabSelect={(i) => setView(VIEW_TABS[i]?.view ?? DEFAULT_VIEW)}
          tabs={VIEW_TABS.map((t) => ({ label: t.label }))}
        >
          <div style={{ paddingTop: 24 }}>{body}</div>
        </Tabs>
      </div>
    </Stack>
  );
}
