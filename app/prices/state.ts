// Result-state shape shared by the P6.3 price-management server actions and the
// client UI that consumes them via useActionState.
//
// This lives OUTSIDE app/prices/actions.ts on purpose: a "use server" file may
// only export async functions (Next.js rule — invalid-use-server-value), so the
// non-function exports (this interface + the initial-state object) must not
// live there (mirrors app/users/state.ts).

export interface PriceActionState {
  status: "idle" | "success" | "error" | "warning";
  /** Top-level message (validation summary, warning explanation, or success note). */
  message?: string;
  /** Field-level validation errors keyed by a form field name. */
  fieldErrors?: Record<string, string>;
  /**
   * On a "warning" result (spec §6/§7: editing/deleting would leave the item
   * with no all-days/all-hours base row), the id of the price row the warning
   * is about. The client UI uses this to show the "confirm and proceed" control
   * on the right row and resubmit the SAME form with `confirmed=true`.
   */
  priceId?: string | null;
}

export const initialPriceActionState: PriceActionState = { status: "idle" };
