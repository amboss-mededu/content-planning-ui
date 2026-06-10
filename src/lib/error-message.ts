/**
 * Normalize an unknown thrown value to a human-readable message.
 * Isomorphic on purpose: no 'use client' / 'server-only', no imports —
 * used by route handlers, workflow code, and client components alike.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
