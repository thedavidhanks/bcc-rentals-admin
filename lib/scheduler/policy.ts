// P9.2 re-export shim. The booking-policy validator now lives in the shared
// @bcc/scheduler package; this path is kept so existing imports
// (`@/lib/scheduler/policy`) resolve unchanged. Do not add logic here — edit
// packages/scheduler/src/scheduler/policy.ts instead.
export * from "@bcc/scheduler/scheduler/policy";
