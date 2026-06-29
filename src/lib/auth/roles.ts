// User-role primitives, shared by the proxy, nav, server guards, and the
// admin "Team roles" screen so the rule lives in exactly one place. Pure and
// dependency-free on purpose — importable from both client and server (and
// from the Edge-ish proxy) without pulling in PocketBase or `server-only`.

export type UserRole = 'editor' | 'architect';

// Least privilege: anything not explicitly an architect is an editor. New
// sign-ups default to editor unless bootstrapped via CONTENT_ARCHITECT_ALLOWLIST.
export const DEFAULT_ROLE: UserRole = 'editor';

/**
 * Coerce an arbitrary stored value (PB returns '' for a select column that was
 * added after the row existed, or undefined when absent) into a known role.
 * Only 'architect' is recognised as elevated; everything else is an editor.
 */
export function normalizeRole(value: unknown): UserRole {
  return value === 'architect' ? 'architect' : DEFAULT_ROLE;
}

export function isArchitect(role: unknown): boolean {
  return normalizeRole(role) === 'architect';
}
