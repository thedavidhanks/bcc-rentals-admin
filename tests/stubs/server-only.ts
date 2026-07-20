// Test stub for the `server-only` marker package. The real package throws when
// imported outside a React Server Component (its `default` export is a throw),
// which breaks unit tests that import server modules. In tests we alias
// `server-only` to this empty module (see vitest.config.ts) so repositories
// under test load normally.
export {};
