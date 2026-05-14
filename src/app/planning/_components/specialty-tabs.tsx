'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

// `numbered: false` tabs are reference/info views, not workflow steps.
// They render a solid dark-green dot with no number or completion
// state — Overview is informational, and Pipeline is the orchestration
// surface that drives the other tabs' completion.
const TABS = [
  { label: 'Overview', segment: '', numbered: false },
  { label: 'Pipeline', segment: 'pipeline', numbered: false },
  { label: 'Milestones', segment: 'milestones', numbered: true },
  { label: 'Categories', segment: 'categories', numbered: true },
  { label: 'Mapping', segment: 'codes', numbered: true },
  { label: 'Consolidation Review', segment: 'consolidation-review', numbered: true },
  { label: 'New Articles', segment: 'articles', numbered: true },
  { label: 'Article Updates', segment: 'sections', numbered: true },
  { label: 'Backlog', segment: 'backlog', numbered: true },
] as const;

// AMBOSS brand orange — used for the active-tab underline (matches
// data-table.tsx, code-detail-modal.tsx accents).
const BRAND = 'rgb(217, 119, 6)';
// AMBOSS green palette for the step indicators. Incomplete steps are
// a saturated dark green; complete steps fade to a soft light-green
// pill with the dark-green check on top.
const GREEN_DARK = 'rgb(15, 95, 50)';
const GREEN_LIGHT = 'rgb(220, 240, 225)';

const navStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 4,
  borderBottom: '1px solid rgb(228, 228, 234)',
  flexWrap: 'wrap',
};

const buttonBase: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  background: 'transparent',
  border: 'none',
  padding: '8px 14px 10px',
  cursor: 'pointer',
  font: 'inherit',
  position: 'relative',
  marginBottom: -1,
};

const circleBase: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 600,
  flexShrink: 0,
  lineHeight: 1,
};

export function SpecialtyTabs({
  slug,
  tabsComplete,
}: {
  slug: string;
  tabsComplete: Record<string, boolean>;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const base = `/planning/${slug}`;
  const rest = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, '')
    : '';
  const currentSegment = rest.split('/')[0] ?? '';

  // Step numbers count only the `numbered: true` tabs — Overview and
  // Pipeline get a solid dark-green dot instead of a number.
  let stepCounter = 0;
  const tabsWithStep = TABS.map((tab) => ({
    ...tab,
    stepNumber: tab.numbered ? ++stepCounter : null,
  }));

  return (
    <div role="tablist" aria-label={`${slug} sections`} style={navStyle}>
      {tabsWithStep.map((tab) => {
        const isActive = tab.segment === currentSegment;
        const isComplete = tab.numbered && tabsComplete[tab.segment] === true;
        const buttonStyle: CSSProperties = {
          ...buttonBase,
          borderBottom: isActive ? `2px solid ${BRAND}` : '2px solid transparent',
          color: isActive ? 'rgb(30, 30, 40)' : 'rgb(90, 90, 100)',
          fontWeight: isActive ? 600 : 400,
        };
        const circleStyle: CSSProperties = tab.numbered
          ? {
              ...circleBase,
              background: isComplete ? GREEN_LIGHT : GREEN_DARK,
              color: isComplete ? GREEN_DARK : 'white',
            }
          : {
              ...circleBase,
              background: GREEN_DARK,
              color: 'white',
            };
        return (
          <button
            key={tab.segment}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            style={buttonStyle}
            onClick={() => {
              router.push(tab.segment ? `${base}/${tab.segment}` : base);
            }}
          >
            <span style={circleStyle} aria-hidden="true">
              {tab.numbered ? (isComplete ? '✓' : tab.stepNumber) : null}
            </span>
            <span style={{ fontSize: 14 }}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
