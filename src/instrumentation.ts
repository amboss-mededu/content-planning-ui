/**
 * Next.js instrumentation hook — runs once per Node process at startup.
 * We use it to boot the article-writing dispatcher singleton so queued
 * runs get picked up without depending on someone hitting an API route
 * to kick the loop into life.
 *
 * Skipped under the Edge runtime (the dispatcher needs the PB admin
 * client and the Node `setTimeout` semantics).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Lazy-import so the Edge runtime build doesn't pull the admin client.
  const { startWritingDispatcher } = await import('@/lib/workflows/dispatcher');
  await startWritingDispatcher();
}
