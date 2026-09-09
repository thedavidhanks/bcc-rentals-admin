// Result-state shape for the P11.3 self-service profile server action, shared
// with the client UI via useActionState.
//
// This lives OUTSIDE app/profile/actions.ts on purpose: a "use server" file
// may only export async functions (Next.js rule — invalid-use-server-value),
// so the non-function exports (this interface + the initial-state object)
// must not live there. Mirrors app/users/state.ts.

export interface ProfileActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /**
   * The name last submitted, echoed back on failure so a rejected save does
   * not wipe whatever the user typed into the (uncontrolled) input.
   * `undefined` means "no submission yet — use the loaded value."
   */
  name?: string;
}

export const initialProfileActionState: ProfileActionState = { status: "idle" };
