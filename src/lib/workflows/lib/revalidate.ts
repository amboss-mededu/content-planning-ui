/**
 * Pipeline-side cache invalidation. Pipelines run in-process now, so we can
 * call `revalidateTag` directly — no HTTP self-call needed. Failures are
 * swallowed: the UI will still see fresh data once cache tags expire
 * naturally, and a stage shouldn't fail because invalidation hiccuped.
 */

import { revalidateTag } from 'next/cache';
import { log } from '@/lib/log';

export async function revalidateSpecialtyCache(slug: string): Promise<void> {
  const tags = [
    `codes:${slug}`,
    `specialty:${slug}`,
    `pipeline:${slug}`,
    'specialty-phases',
    'specialties',
  ];
  log('pipeline').info('revalidateSpecialtyCache', { slug, tags });
  try {
    for (const t of tags) {
      revalidateTag(t, 'max');
    }
  } catch (e) {
    log('pipeline').warn('revalidateSpecialtyCache threw', e);
  }
}
