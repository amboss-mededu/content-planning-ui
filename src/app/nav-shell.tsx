import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { NavBarDynamic } from './nav-bar-dynamic';
import { NavShellFooter } from './nav-shell-footer';
import { SpecialtyModeProvider } from './specialty-mode-context';

export async function NavShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    // Provider wraps both the nav and the page tree so a specialty detail page
    // can tell the secondary nav which subtab to keep highlighted.
    <SpecialtyModeProvider>
      <div className="nav-fixed">
        <Suspense fallback={<div className="nav-placeholder" />}>
          <NavBarDynamic user={user} />
        </Suspense>
      </div>

      <main className="content">
        <div className="content-inner">
          <NavShellFooter>{children}</NavShellFooter>
        </div>
      </main>
    </SpecialtyModeProvider>
  );
}
