import { redirect } from 'next/navigation';

// The dedicated home dashboard was merged into the Specialty Dashboard
// (`/planning`), which now hosts the specialty grid, the all-specialties
// overview, and specialty creation. Keep `/` working (logo + brand nav point
// here) by redirecting to the consolidated dashboard.
export default function Home() {
  redirect('/planning');
}
