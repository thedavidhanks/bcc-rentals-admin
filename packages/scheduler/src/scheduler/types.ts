import { z } from "zod";

// P9.2: extracted into the shared @bcc/scheduler package (was admin
// lib/scheduler/types.ts; lib/scheduler/types.ts is now a re-export shim).
// TODO(P9): consolidate — adapted from storefront lib/scheduler/types.ts; P9.3/P9.4
// reconcile the two shapes behind this single module.
// Admin differences: reservations default to status 'block' (staff holds, not paid
// storefront bookings), carry optional group_id/series_id, and bufferMinutes is an
// optional override (the engine defaults to the item's buffer_minutes column).

export const reservationStatusSchema = z.enum(["confirmed", "block", "cancelled"]);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

/** Contact details embedded on a reservation. For staff blocks, use to note who/why. */
export const reservationCustomerSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
});
export type ReservationCustomer = z.infer<typeof reservationCustomerSchema>;

const isoOffset = z.string().datetime({ offset: true });
const endAfterStart = (d: { startISO: string; endISO: string }) =>
  new Date(d.endISO).getTime() > new Date(d.startISO).getTime();
const endAfterStartMsg = { message: "endISO must be after startISO", path: ["endISO"] };

export const getAvailabilityInputSchema = z
  .object({
    itemSlug: z.string().min(1),
    startISO: isoOffset,
    endISO: isoOffset,
    quantity: z.number().int().positive().default(1),
    // Override the item's buffer_minutes; omit to use the column value.
    bufferMinutes: z.number().int().nonnegative().optional(),
  })
  .refine(endAfterStart, endAfterStartMsg);
export type GetAvailabilityInput = z.input<typeof getAvailabilityInputSchema>;

export const createReservationInputSchema = z
  .object({
    itemSlug: z.string().min(1),
    startISO: isoOffset,
    endISO: isoOffset,
    quantity: z.number().int().positive().default(1),
    bufferMinutes: z.number().int().nonnegative().optional(),
    status: reservationStatusSchema.default("block"),
    notes: z.string().optional(),
    customer: reservationCustomerSchema.optional(),
    groupId: z.string().uuid().optional(),
    seriesId: z.string().uuid().optional(),
  })
  .refine(endAfterStart, endAfterStartMsg);
export type CreateReservationInput = z.input<typeof createReservationInputSchema>;

/** A single line item within a multi-item / multi-occurrence booking. */
export const bookingLineSchema = z
  .object({
    itemSlug: z.string().min(1),
    quantity: z.number().int().positive().default(1),
    startISO: isoOffset,
    endISO: isoOffset,
    bufferMinutes: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
    customer: reservationCustomerSchema.optional(),
  })
  .refine(endAfterStart, endAfterStartMsg);
export type BookingLineInput = z.input<typeof bookingLineSchema>;

/**
 * One occurrence of a booking. Materializes as a single reservation_groups row
 * plus one reservations row per line (see spec §9). For a one-off booking there
 * is a single group; for a recurring series there is one group per occurrence.
 */
export const bookingGroupSchema = z.object({
  title: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  notes: z.string().optional(),
  /** Anchor instant of this occurrence (null/omitted = one-off). */
  occurrenceAt: isoOffset.optional(),
  /** Human label used in failure reporting, e.g. the Eastern date "2026-08-01". */
  occurrenceKey: z.string().optional(),
  lines: z.array(bookingLineSchema).min(1),
});
export type BookingGroupInput = z.input<typeof bookingGroupSchema>;

export const createBookingInputSchema = z.object({
  /** app_users.uid of the scheduler/admin committing the booking (stored on the group). */
  createdBy: z.string().optional(),
  /** Series id applied to every group + reservation row (recurring bookings). */
  seriesId: z.string().uuid().optional(),
  groups: z.array(bookingGroupSchema).min(1),
});
export type CreateBookingInput = z.input<typeof createBookingInputSchema>;

/** A reservation as returned by the engine (camelCase, ISO strings). */
export type Reservation = {
  id: string;
  itemId: string;
  itemSlug: string;
  quantity: number;
  startISO: string;
  endISO: string;
  status: ReservationStatus;
  orderId: string | null;
  customer: { email: string | null; name: string | null; phone: string | null };
  notes: string | null;
  groupId: string | null;
  seriesId: string | null;
  createdAt: string;
};

/** Availability for an item over a window, plus the overlapping reservations. */
export type Availability = {
  itemSlug: string;
  itemId: string;
  totalStock: number;
  requested: number;
  reserved: number;
  available: number;
  isAvailable: boolean;
  reservations: Reservation[];
};

/** Result of a committed multi-item / multi-occurrence booking. */
export type BookingResult = {
  groups: Array<{
    id: string;
    occurrenceKey: string | null;
    reservations: Reservation[];
  }>;
  reservationCount: number;
};
