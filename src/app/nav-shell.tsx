import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { NavBarDynamic } from './nav-bar-dynamic';
import { NavShellFooter } from './nav-shell-footer';

export async function NavShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
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
    </>
  );
}
