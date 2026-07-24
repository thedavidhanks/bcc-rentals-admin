// P9.2 re-export shim. The shared catalog/reservation row shapes (plus the
// admin-owned table shapes that moved with them) now live in the shared
// @bcc/scheduler package as products/types; this path is kept so existing imports
// (`./types` across lib/repositories/*, `@/lib/repositories/types`) resolve
// unchanged. Do not add logic here — edit packages/scheduler/src/products/types.ts.
export * from "@bcc/scheduler/products/types";
