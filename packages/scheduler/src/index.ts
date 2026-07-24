// @bcc/scheduler — shared scheduler + catalog surface (phase P9).
//
// Root barrel. Consumers may also import the narrower subpaths directly:
//   @bcc/scheduler/scheduler/errors
//   @bcc/scheduler/scheduler/policy
//   @bcc/scheduler/scheduler/types
//   @bcc/scheduler/products/types
//
// The shared-table row shapes are namespaced under `products` to avoid name
// collisions with the scheduler engine types (e.g. both define ReservationStatus,
// one as a zod-derived enum, the other as the DB row union).

export * from "./scheduler/errors";
export * from "./scheduler/policy";
export * from "./scheduler/types";
export * as products from "./products/types";
