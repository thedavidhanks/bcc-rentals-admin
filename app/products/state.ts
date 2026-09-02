// Result-state shape shared by the P6.4 product-management server actions and
// the client UI that consumes them via useActionState.
//
// This lives OUTSIDE app/products/actions.ts on purpose: a "use server" file
// may only export async functions (Next.js rule — invalid-use-server-value),
// so the non-function exports (this interface + the initial-state object)
// must not live there. Keep types/constants here; keep actions in actions.ts.
// Mirrors app/users/state.ts (P6.6).

export interface ProductsActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  itemId?: string;
}

export const initialProductsActionState: ProductsActionState = { status: "idle" };
