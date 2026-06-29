import type { CurriculumPlanStats } from '@/lib/data/curriculum-plans';
import type { StatItem } from '../../_components/coverage-stats';

/**
 * The always-visible curriculum overview stat tiles — the headline numbers for a
 * curriculum plan (items, approved %, mapped, articles, questions). Rendered
 * above the analytics tabs by `CurriculumDashboard`, so they stay on screen
 * regardless of the active tab.
 */
export function curriculumStatTiles(stats: CurriculumPlanStats): StatItem[] {
  const approvedPct =
    stats.totalItems > 0 ? Math.round((stats.approved / stats.totalItems) * 100) : 0;
  return [
    {
      label: 'Curriculum items',
      value: stats.totalItems,
      hint: `${stats.pending} pending · ${stats.rejected} rejected`,
    },
    {
      label: 'Approved',
      value: `${approvedPct}%`,
      hint: `${stats.approved} of ${stats.totalItems}`,
    },
    {
      label: 'Mapped',
      value: stats.mapped,
      hint: `${stats.inAmboss} in AMBOSS`,
    },
    {
      label: 'Articles',
      value: stats.uniqueArticles,
      hint: 'unique articles covered',
    },
    {
      label: 'Questions',
      value: stats.uniqueQuestions,
      hint: `${stats.totalQuestions} total`,
    },
  ];
}
