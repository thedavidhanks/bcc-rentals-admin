// Result-state shape shared by the P6.6 user-management server actions and the
// client UI that consumes them via useActionState.
//
// This lives OUTSIDE app/users/actions.ts on purpose: a "use server" file may
// only export async functions (Next.js rule — invalid-use-server-value), so the
// non-function exports (this interface + the initial-state object) must not live
// there. Keep types/constants here; keep actions in actions.ts.

export interface UsersActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialUsersActionState: UsersActionState = { status: "idle" };
