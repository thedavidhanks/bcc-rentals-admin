"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/guards";
import { withTransaction } from "@/lib/db";
import { writeAuditLog } from "@/lib/repositories/audit-log";
import {
  countActiveAdmins,
  createInvite,
  getUserById,
  InviteAlreadyExistsError,
  revokeInvite,
  setUserActive,
  updateUserRole,
} from "@/lib/repositories/app-users";
import type { UsersActionState } from "./state";

// User management server actions (execution-plan P6.6, spec §3/§6/§7). Every
// action is ADMIN-ONLY — requireAdmin() runs FIRST, before any parsing or DB
// work, so authorization is enforced on the server and never on hidden UI.
//
// Each mutation + its audit row (CLAUDE.md: audit EVERY mutation) run inside ONE
// withTransaction so they commit atomically. The last-active-admin guard runs the
// mutation, then re-counts active admins INSIDE the same transaction and THROWS to
// roll back if the change would leave zero admins — this closes the race between
// two admins acting at once (a pre-check alone can't). Deactivate, never delete.

// Result state (shape consumed by useActionState in the client form) lives in
// ./state — a "use server" file may only export async functions.

/** Rolling back to keep at least one active admin (spec §6). */
class LastAdminError extends Error {
  constructor(message = "This would remove the last active admin.") {
    super(message);
    this.name = "LastAdminError";
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const roleSchema: z.ZodType<"scheduler" | "admin"> = z.enum([
  "scheduler",
  "admin",
]);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  role: roleSchema,
});

const idSchema = z.string().trim().min(1, "Missing user id.");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    fieldErrors[issue.path.join(".")] = issue.message;
  }
  return fieldErrors;
}

/** Resolve a target user row by its app_users.id, or return an error state. */
async function loadTargetById(id: string) {
  const row = await getUserById(id);
  if (!row) {
    return { row: null, error: { status: "error" as const, message: "User not found." } };
  }
  return { row, error: null };
}

// ---------------------------------------------------------------------------
// Invite a user by email
// ---------------------------------------------------------------------------

export async function inviteUserAction(
  _prevState: UsersActionState,
  formData: FormData,
): Promise<UsersActionState> {
  const admin = await requireAdmin();

  const parsed = inviteSchema.safeParse({
    email: formData.get("email") ?? "",
    name: formData.get("name") ?? "",
    role: formData.get("role") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const { email, name, role } = parsed.data;

  try {
    await withTransaction(async (client) => {
      const invite = await createInvite({ email, name, role }, client);
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "user.invite.create",
          entity: "app_users",
          entity_id: invite.id,
          detail: {
            before: null,
            after: { email: invite.email, name: invite.name, role: invite.role },
          },
        },
        client,
      );
    });
  } catch (err) {
    if (err instanceof InviteAlreadyExistsError) {
      return {
        status: "error",
        message: err.message,
        fieldErrors: { email: "An open invite already exists for this email." },
      };
    }
    return { status: "error", message: "Could not create the invite. Please try again." };
  }

  revalidatePath("/users");
  return { status: "success", message: `Invited ${email} as ${role}.` };
}

// ---------------------------------------------------------------------------
// Revoke a pending invite
// ---------------------------------------------------------------------------

export async function revokeInviteAction(
  _prevState: UsersActionState,
  formData: FormData,
): Promise<UsersActionState> {
  const admin = await requireAdmin();

  const parsedId = idSchema.safeParse(formData.get("id") ?? "");
  if (!parsedId.success) {
    return { status: "error", message: "Missing invite id." };
  }
  const id = parsedId.data;

  const { row, error } = await loadTargetById(id);
  if (error) return error;
  if (row.uid !== null) {
    return { status: "error", message: "That account is already active — deactivate it instead." };
  }

  try {
    await withTransaction(async (client) => {
      const removed = await revokeInvite(id, client);
      if (!removed) throw new Error("invite not found");
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "user.invite.revoke",
          entity: "app_users",
          entity_id: id,
          detail: { before: { email: row.email, role: row.role, pending: true }, after: null },
        },
        client,
      );
    });
  } catch {
    return { status: "error", message: "Could not revoke the invite. Please try again." };
  }

  revalidatePath("/users");
  return { status: "success", message: "Invite revoked." };
}

// ---------------------------------------------------------------------------
// Set role (scheduler <-> admin)
// ---------------------------------------------------------------------------

export async function setRoleAction(
  _prevState: UsersActionState,
  formData: FormData,
): Promise<UsersActionState> {
  const admin = await requireAdmin();

  const parsedId = idSchema.safeParse(formData.get("id") ?? "");
  const parsedRole = roleSchema.safeParse(formData.get("role") ?? "");
  if (!parsedId.success || !parsedRole.success) {
    return { status: "error", message: "Invalid role change request." };
  }
  const id = parsedId.data;
  const role = parsedRole.data;

  const { row, error } = await loadTargetById(id);
  if (error) return error;
  if (row.uid === null) {
    return { status: "error", message: "Set the role when creating the invite; a pending invite has no role to change here." };
  }
  const targetUid = row.uid;

  // Friendly pre-check: demoting the last active admin. The transactional
  // re-check below is the real guard against a concurrent second admin change.
  if (row.role === "admin" && role === "scheduler" && row.active) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      return {
        status: "error",
        message: "You can't demote the last active admin — promote another admin first.",
      };
    }
  }

  try {
    await withTransaction(async (client) => {
      const updated = await updateUserRole(targetUid, role, client);
      if (!updated) throw new Error("user not found");

      // Transactional re-check: never leave zero active admins.
      if (await countActiveAdmins(client) === 0) throw new LastAdminError();

      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "user.role.update",
          entity: "app_users",
          entity_id: updated.id,
          detail: { before: { role: row.role }, after: { role: updated.role } },
        },
        client,
      );
    });
  } catch (err) {
    if (err instanceof LastAdminError) {
      return {
        status: "error",
        message: "You can't demote the last active admin — promote another admin first.",
      };
    }
    return { status: "error", message: "Could not change the role. Please try again." };
  }

  // TODO(P6.6): optional custom-claim mirror. Best-effort only: after the DB
  // commit, call getAdminAuth().setCustomUserClaims(targetUid, { role }) so a
  // future claims-reading middleware has a fast path. The DB row stays
  // authoritative, so a failure here must be swallowed and must NEVER fail the
  // committed role change. Deferred — middleware is cookie-presence-only today.

  revalidatePath("/users");
  return { status: "success", message: `Role updated to ${role}.` };
}

// ---------------------------------------------------------------------------
// Activate / deactivate (deactivate, never delete)
// ---------------------------------------------------------------------------

export async function setActiveAction(
  _prevState: UsersActionState,
  formData: FormData,
): Promise<UsersActionState> {
  const admin = await requireAdmin();

  const parsedId = idSchema.safeParse(formData.get("id") ?? "");
  const activeRaw = formData.get("active");
  if (!parsedId.success || (activeRaw !== "true" && activeRaw !== "false")) {
    return { status: "error", message: "Invalid activation request." };
  }
  const id = parsedId.data;
  const active = activeRaw === "true";

  const { row, error } = await loadTargetById(id);
  if (error) return error;
  if (row.uid === null) {
    return { status: "error", message: "A pending invite can't be activated — the user activates it by signing in." };
  }
  const targetUid = row.uid;

  // Friendly pre-check: deactivating the last active admin.
  if (!active && row.role === "admin" && row.active) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      return {
        status: "error",
        message: "You can't deactivate the last active admin — promote or activate another admin first.",
      };
    }
  }

  try {
    await withTransaction(async (client) => {
      const updated = await setUserActive(targetUid, active, client);
      if (!updated) throw new Error("user not found");

      // Transactional re-check: never leave zero active admins.
      if (await countActiveAdmins(client) === 0) throw new LastAdminError();

      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: active ? "user.activate" : "user.deactivate",
          entity: "app_users",
          entity_id: updated.id,
          detail: { before: { active: row.active }, after: { active: updated.active } },
        },
        client,
      );
    });
  } catch (err) {
    if (err instanceof LastAdminError) {
      return {
        status: "error",
        message: "You can't deactivate the last active admin — promote or activate another admin first.",
      };
    }
    return { status: "error", message: "Could not update the account. Please try again." };
  }

  revalidatePath("/users");
  return { status: "success", message: active ? "Account activated." : "Account deactivated." };
}
