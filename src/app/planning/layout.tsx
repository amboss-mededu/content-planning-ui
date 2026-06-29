import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export default async function PlanningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Architect-only area. The proxy redirects editors here too, but that reads a
  // forgeable cookie — this server-validated check (getCurrentUser verifies the
  // token and reads the DB role) is the authoritative read-gate, so a forged
  // cookie can't expose pipeline/mapping/curriculum data to an editor.
  const user = await getCurrentUser();
  if (user?.role !== 'architect') redirect('/my-backlog');

  return <>{children}</>;
}
