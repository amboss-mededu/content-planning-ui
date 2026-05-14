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

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Specialty Dashboard', href: '/planning' },
  { label: 'My Backlog', href: '/my-backlog' },
];

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
  const activeIndex = Math.max(
    0,
    NAV_ITEMS.findIndex((item) =>
      item.href === '/'
        ? pathname === '/'
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    ),
  );

  return (
    <NavBar subTheme={NavBarName.Learning} isCompact={isCompact}>
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
                <NavBar.PrimaryNavItem label="Content Planner" href="/" isActive />
              </NavBar.PrimaryNav>
            )}
          </Inline>
          <div className="primary-nav-user">{user ? <UserMenu user={user} /> : null}</div>
        </div>
      </NavBar.PrimaryNavContainer>
      {isAuthenticated && (
        <NavBar.SubMenuContainer>
          <Box space="m" vSpace="zero">
            <NavBar.SecondaryNav
              aria-label="Secondary navigation"
              items={NAV_ITEMS}
              activeIndex={activeIndex}
            />
          </Box>
        </NavBar.SubMenuContainer>
      )}
    </NavBar>
  );
}
