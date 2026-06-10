// Test stub for the `server-only` package. The real module throws on import
// outside a React Server Component bundle; under vitest/jsdom that would break
// any test that imports a `server-only` data/parsing module. Aliased in
// vitest.config.ts.
export {};
