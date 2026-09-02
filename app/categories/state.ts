// Result-state shape shared by the P6.5 categories server actions and the client
// UI that consumes them via useActionState.
//
// This lives OUTSIDE app/categories/actions.ts on purpose: a "use server" file may
// only export async functions (Next.js "invalid-use-server-value" rule — learned in
// P6.6/app/users), so the non-function exports (this interface + the initial-state
// object) must not live there. Keep types/constants here; keep actions in actions.ts.

export interface CategoriesActionState {
  status: "idle" | "success" | "error" | "confirm";
  message?: string;
  fieldErrors?: Record<string, string>;
  /**
   * Present only when status === "confirm": deleting this category would drop
   * assigned `item_categories` rows, so the UI must re-submit with
   * `confirmed=true` for this same category id before the delete proceeds.
   */
  confirmCategoryId?: string;
}

export const initialCategoriesActionState: CategoriesActionState = { status: "idle" };
