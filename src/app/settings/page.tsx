import { getCurrentUser } from '@/lib/auth';
import { listAllUsersWithRoles } from '@/lib/data/users';
import { SettingsView } from './_components/settings-view';

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const isArchitect = user?.role === 'architect';
  // Architect-only: load the team roster for the Team roles panel. Rendering
  // happens inside SettingsView (a client component) — design-system primitives
  // can't be rendered from this server component.
  const members = isArchitect ? await listAllUsersWithRoles() : [];

  return (
    <SettingsView
      isArchitect={isArchitect}
      teamMembers={members}
      viewerId={user?._id ?? ''}
    />
  );
}
