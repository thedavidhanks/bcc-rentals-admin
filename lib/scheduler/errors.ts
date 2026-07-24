// P9.2 re-export shim. The scheduler error taxonomy now lives in the shared
// @bcc/scheduler package; this path is kept so existing imports
// (`@/lib/scheduler/errors`, `./errors`) resolve unchanged. Do not add logic
// here — edit packages/scheduler/src/scheduler/errors.ts instead.
export * from "@bcc/scheduler/scheduler/errors";
