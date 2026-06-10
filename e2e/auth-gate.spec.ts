import { expect, test } from '@playwright/test';

/**
 * Pins the proxy.ts auth gate for page navigations. Runs without a
 * PocketBase backend or auth fixtures (the gate only parses the cookie
 * header locally), so it works in CI's fixture-less e2e job.
 *
 * Skipped when DEV_AUTOLOGIN_EMAIL is configured on the dev server —
 * the gate then redirects through /api/auth/dev-autologin instead of
 * /login, which is the complementary path planning-table.spec.ts covers.
 */

test('unauthenticated planning navigation redirects to login with a next target', async ({
  page,
}) => {
  await page.goto('/planning');
  test.skip(
    !page.url().includes('/login'),
    'dev-autologin is enabled; the login gate is bypassed locally',
  );
  await expect(page).toHaveURL(/\/login\?next=%2Fplanning/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // The OAuth button carries the next target through to the login API.
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
    'href',
    '/api/auth/login/google?next=%2Fplanning',
  );
});

test('nested specialty routes preserve their full path in the next param', async ({
  page,
}) => {
  await page.goto('/planning/cardiology/pipeline');
  test.skip(
    !page.url().includes('/login'),
    'dev-autologin is enabled; the login gate is bypassed locally',
  );
  await expect(page).toHaveURL(/\/login\?next=%2Fplanning%2Fcardiology%2Fpipeline/);
});
