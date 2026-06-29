'use client';

import {
  Box,
  DropdownMenu,
  Inline,
  Logo,
  NavBar,
  NavBarName,
} from '@amboss/design-system';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { CurrentUser } from '@/lib/auth';

type SectionKey = 'learning' | 'clinical-care' | 'teaching' | 'content-planner';

interface NavLink {
  label: string;
  href: string;
  // DS `SecondaryNavItem` carries an index signature (extra props forwarded to
  // the rendered element); mirror it so `secondary` is assignable to that prop.
  [key: string]: unknown;
}

interface Section {
  key: SectionKey;
  label: string;
  /** Primary-nav target. */
  href: string;
  /** Which DS sub-theme paints the nav for this section: Learning = brand
   *  (green), ClinicalCare = unset (white), Teaching = dimmed (dark grey). */
  subTheme: NavBarName;
  /** True when the current pathname belongs to this section. */
  match: (pathname: string) => boolean;
  /** Contextual secondary-nav items; empty hides the secondary row. */
  secondary: NavLink[];
}

// Tab order: Learning, Clinical Care, Teaching, Content Planner (last). Each
// section owns its primary tab, its nav color, and its secondary nav. The
// `match` order doesn't matter (prefixes are disjoint); `content-planner` is the
// fallback so `/`, `/settings`, and any unknown authed path read as Content
// Planner.
const SECTIONS: Section[] = [
  {
    key: 'learning',
    label: 'Learning',
    href: '/learning',
    subTheme: NavBarName.Learning,
    match: (p) => p.startsWith('/learning'),
    secondary: [],
  },
  {
    key: 'clinical-care',
    label: 'Clinical Care',
    href: '/clinical-care',
    subTheme: NavBarName.ClinicalCare,
    match: (p) => p.startsWith('/clinical-care'),
    secondary: [],
  },
  {
    key: 'teaching',
    label: 'Teaching',
    // Curriculum plans moved under Content Planner; the Teaching tab is kept but
    // /teaching just redirects into that subtab (no own secondary nav).
    href: '/teaching',
    subTheme: NavBarName.Teaching,
    match: (p) => p.startsWith('/teaching'),
    secondary: [],
  },
  {
    key: 'content-planner',
    label: 'Content Planner',
    href: '/planning',
    subTheme: NavBarName.Learning,
    match: (p) =>
      p.startsWith('/planning') ||
      p.startsWith('/my-backlog') ||
      p.startsWith('/settings'),
    secondary: [
      { label: 'Full pipeline', href: '/planning/full-pipeline' },
      { label: 'RAG corpus', href: '/planning/rag-corpus' },
      { label: 'Mapping', href: '/planning/mapping' },
      { label: 'Curriculum plans', href: '/planning/curriculum-plans' },
      { label: 'My Backlog', href: '/my-backlog' },
    ],
  },
];

const CONTENT_PLANNER = SECTIONS[SECTIONS.length - 1] as Section;

function activeSecondaryIndex(items: NavLink[], pathname: string): number {
  return Math.max(
    0,
    items.findIndex(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    ),
  );
}

function useScrollCompact() {
  const [isCompact, setIsCompact] = useState(false);
  const previousScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      const previousY = previousScrollY.current;
      if (currentY > previousY && currentY > 0) setIsCompact(true);
      else if (currentY < previousY) setIsCompact(false);
      previousScrollY.current = currentY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return isCompact;
}

function UserMenu({ user }: { user: CurrentUser }) {
  const router = useRouter();
  if (!user.email) return null;
  const localPart = user.email.split('@')[0] ?? user.email;

  return (
    <DropdownMenu
      label={localPart}
      iconName="user"
      triggerAriaLabel={`Open user menu for ${localPart}`}
      menuItems={[
        { label: 'Settings', onSelect: () => router.push('/settings') },
        'separator',
        {
          label: 'Sign out',
          onSelect: async () => {
            // Hard navigation guarantees the proxy reads the cleared cookie
            // on the next request. The /api/auth/logout endpoint clears the
            // pb_auth cookie and 303-redirects to /login.
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.assign('/login');
          },
        },
      ]}
    />
  );
}

export function NavBarDynamic({ user }: { user: CurrentUser | null }) {
  const pathname = usePathname() ?? '/';
  const isCompact = useScrollCompact();
  const isAuthenticated = !!user;
  const active = SECTIONS.find((s) => s.match(pathname)) ?? CONTENT_PLANNER;
  const hasSecondary = active.secondary.length > 0;

  return (
    <NavBar subTheme={active.subTheme} isCompact={isCompact}>
      <NavBar.PrimaryNavContainer>
        <div
          className={
            isAuthenticated
              ? 'primary-nav-content'
              : 'primary-nav-content primary-nav-content--solo'
          }
        >
          <Inline space="m" vAlignItems="center">
            <Logo href="/" ariaLabel="AMBOSS Content Planner — Home" />
            {isAuthenticated && (
              <NavBar.PrimaryNav aria-label="Main navigation">
                {SECTIONS.map((section) => (
                  <NavBar.PrimaryNavItem
                    key={section.key}
                    label={section.label}
                    href={section.href}
                    isActive={section.key === active.key}
                  />
                ))}
              </NavBar.PrimaryNav>
            )}
          </Inline>
          <div className="primary-nav-user">{user ? <UserMenu user={user} /> : null}</div>
        </div>
      </NavBar.PrimaryNavContainer>
      {isAuthenticated && !isCompact && hasSecondary && (
        <NavBar.SubMenuContainer>
          <Box space="m" vSpace="zero">
            <NavBar.SecondaryNav
              aria-label="Secondary navigation"
              items={active.secondary}
              activeIndex={activeSecondaryIndex(active.secondary, pathname)}
            />
          </Box>
        </NavBar.SubMenuContainer>
      )}
    </NavBar>
  );
}
