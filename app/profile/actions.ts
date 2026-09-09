"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireScheduler } from "@/lib/auth/guards";
import { withTransaction } from "@/lib/db";
import { writeAuditLog } from "@/lib/repositories/audit-log";
import { getUserByUid, updateUserName } from "@/lib/repositories/app-users";
import type { ProfileActionState } from "./state";

// Self-service profile server action (execution-plan P11.3, spec §3/§5/§7).
//
// SECURITY (this is the whole reason this route is worth a work order — a
// self-service editor that can be coaxed into writing someone else's row, or
// its own role, is a privilege-escalation bug):
//   1. requireScheduler() runs FIRST, before any parsing or DB work.
//   2. The write is keyed ONLY off the guard's returned `user.uid`. The
//      FormData is NEVER read for a `uid` / `id` / `email` — there is no
//      target-identifier field on this form at all, by construction.
//   3. `updateUserName` (lib/repositories/app-users.ts) is structurally
//      scoped to set ONLY `name` + `updated_at` — `role` and `active` are
//      unreachable from this action, full stop.
//   4. The mutation and its audit row commit inside ONE withTransaction, so
//      they land atomically (CLAUDE.md: audit EVERY mutation) — a thrown
//      error anywhere inside rolls both back.
//
// Result state (consumed by useActionState in the client form) lives in
// ./state — a "use server" file may only export async functions.

/**
 * Thrown when the caller's own app_users row can't be found/updated inside
 * the transaction (e.g. a dev-bypass session with no app_users row at all —
 * this app never auto-provisions, spec §3). Rolls back the transaction; the
 * caller gets a clean error state instead of a silent 0-row update.
 */
class ProfileNotFoundError extends Error {
  constructor(
    message = "Your account record could not be found. Contact an admin.",
  ) {
    super(message);
    this.name = "ProfileNotFoundError";
  }
}

// Empty / whitespace-only clears the name to null: app_users.name is
// nullable, and the account-menu monogram (components/nav/account-menu.ts)
// already falls back to email when name is null/empty.
const nameSchema = z
  .string()
  .trim()
  .max(200, "Name must be 200 characters or fewer.")
  .transform((v) => (v.length === 0 ? null : v));

export async function updateProfileAction(
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  // Guard FIRST — before touching formData at all.
  const user = await requireScheduler();

  const rawNameEntry = formData.get("name");
  const rawName = typeof rawNameEntry === "string" ? rawNameEntry : "";

  const parsed = nameSchema.safeParse(rawName);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: parsed.error.issues[0]?.message ?? "Invalid name." },
      name: rawName,
    };
  }
  const name = parsed.data;

  try {
    await withTransaction(async (client) => {
      // Best-effort "before" snapshot for the audit detail. Keyed by the
      // SESSION uid only (never by anything read from the client/FormData).
      const before = await getUserByUid(user.uid, client);

      const updated = await updateUserName(user.uid, name, client);
      if (!updated) throw new ProfileNotFoundError();

      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "user.profile.update",
          entity: "app_users",
          entity_id: updated.id,
          detail: {
            before: { name: before?.name ?? null },
            after: { name: updated.name },
          },
        },
        client,
      );
    });
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      return { status: "error", message: err.message, name: rawName };
    }
    return {
      status: "error",
      message: "Could not update your profile. Please try again.",
      name: rawName,
    };
  }

  revalidatePath("/profile");
  // Also revalidate the layout so the account-menu monogram (rendered from
  // the session's name in app/layout.tsx) refreshes after a name change.
  revalidatePath("/", "layout");
  return { status: "success", message: "Profile updated.", name: name ?? "" };
}
