import { redirect } from 'next/navigation';

// Teaching has no standalone landing yet — its only surface is the Curriculum
// Plans dashboard, which the secondary nav also points to. Send the bare
// /teaching route straight there.
export default function TeachingIndex() {
  redirect('/teaching/curriculum-plans');
}
