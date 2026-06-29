import { redirect } from 'next/navigation';

// Curriculum plans now live under Content Planner. The Teaching primary-nav tab
// is kept, but it has no standalone surface — send the bare /teaching route to
// the Curriculum plans subtab.
export default function TeachingIndex() {
  redirect('/planning/curriculum-plans');
}
