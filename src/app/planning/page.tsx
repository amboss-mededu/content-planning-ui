import { redirect } from 'next/navigation';

// Content Planner's dashboard is now split into per-mode subtabs. The bare
// /planning entry (primary nav + Logo's `/` landing) routes to the default
// "Full pipeline" subtab.
export default function PlanningIndex() {
  redirect('/planning/full-pipeline');
}
