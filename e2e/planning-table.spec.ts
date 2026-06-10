import { expect, test } from '@playwright/test';

/**
 * Real-browser smoke for the planning DataTable: sort via the header menu,
 * then prove the view-state localStorage round-trip survives a reload —
 * the one behavior jsdom can't verify (data-table.test.tsx covers the
 * rest in unit form).
 *
 * Runs only against a signed-in session with data, i.e. a local dev
 * server with DEV_AUTOLOGIN_EMAIL and a seeded PocketBase. In CI (no
 * auth fixtures) it skips; auth-gate.spec.ts covers that environment.
 */

test('table sort persists to localStorage across a reload', async ({ page }) => {
  await page.goto('/planning');
  test.skip(
    page.url().includes('/login'),
    'no signed-in session (CI has no auth fixtures); covered by auth-gate.spec.ts',
  );

  // Find the first specialty. The grid streams in behind Suspense, so
  // wait for a link rather than counting instantly.
  const specialtyLink = page.locator('a[href^="/planning/"]').first();
  const hasSpecialty = await specialtyLink
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!hasSpecialty, 'no specialties seeded locally');
  const slug = (await specialtyLink.getAttribute('href'))?.split('/')[2];
  test.skip(!slug, 'could not derive a specialty slug');

  // The specialty landing page is an overview; tables live on sub-routes.
  // Probe until one renders a DataTable (its toolbar always shows
  // "Clear filters"); a sub-route with no rows renders emptyText instead.
  const clearFilters = page.getByRole('button', { name: 'Clear filters' }).first();
  let hasTable = false;
  for (const sub of ['backlog', 'sections', 'articles', 'sources', 'mapping']) {
    await page.goto(`/planning/${slug}/${sub}`);
    hasTable = await clearFilters
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (hasTable) break;
  }
  test.skip(!hasTable, `no populated DataTable on any ${slug} sub-route`);

  await expect(page.getByText(/\d[\d,]* rows/).first()).toBeVisible();

  // Open the first sortable header menu and sort ascending.
  const headerButton = page.locator('thead button[aria-expanded]').first();
  await headerButton.click();
  const menu = page.getByRole('dialog', { name: / options$/ });
  await menu.getByText('Sort ascending').click();

  // The persist effect writes a v:1 payload with the sort under the
  // table's storageKey.
  const storedSort = () =>
    page.evaluate(() => {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        try {
          const parsed = JSON.parse(window.localStorage.getItem(key) ?? '');
          if (parsed?.v === 1 && parsed.sort) return { key, sort: parsed.sort };
        } catch {
          // Not a table payload — keep scanning.
        }
      }
      return null;
    });
  const before = await storedSort();
  expect(before?.sort?.dir).toBe('asc');

  // Reload: hydration restores the sort, and the persist effect must NOT
  // clobber it back to defaults (the remount race the storage code guards).
  await page.reload();
  await expect(page.getByText(/\d[\d,]* rows/).first()).toBeVisible();
  const after = await storedSort();
  expect(after).toEqual(before);
});
