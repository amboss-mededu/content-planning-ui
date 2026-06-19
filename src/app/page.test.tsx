import { describe, expect, it } from 'vitest';

// `/` is a server-side redirect to `/planning` (see page.tsx), so there's
// nothing to render-test here. Vitest still needs at least one test file in
// `src/**/*.test.{ts,tsx}` to avoid "No test files found" failing CI.
describe('sanity', () => {
  it('runs the test harness', () => {
    expect(1 + 1).toBe(2);
  });
});
