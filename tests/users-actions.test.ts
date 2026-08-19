import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUserRow } from "../lib/repositories/types";

// P6.6 — user-management server-action tests (app/users/actions.ts). Mirrors
// tests/add-reservation-action.test.ts: mock the guard, withTransaction, the repo
// fns, writeAuditLog + next/cache, drive each action with FormData, and assert the
// returned UsersActionState (or that requireAdmin's throw propagates).
//
// Everything referenced inside a vi.mock factory is created via vi.hoisted so it
// exists when the hoisted factories run.
const {
  requireAdmin,
  withTransaction,
  writeAuditLog,
  createInvite,
  revokeInvite,
  updateUserRole,
  setUserActive,
  getUserById,
  countActiveAdmins,
  InviteAlreadyExistsError,
  revalidatePath,
} = vi.hoisted(() => {
  class InviteAlreadyExistsError extends Error {
    constructor(email: string) {
      super(`An open invite already exists for ${email}.`);
      this.name = "InviteAlreadyExistsError";
    }
  }
  return {
    requireAdmin: vi.fn(async () => ({
      uid: "admin-uid",
      email: "admin@bachmancc.org",
      role: "admin" as const,
    })),
    withTransaction: vi.fn(
      async (fn: (client: unknown) => unknown) =>
        fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
    ),
    writeAuditLog: vi.fn(async (_entry: Record<string, unknown>, _client?: unknown) => ({})),
    createInvite: vi.fn(async (_input: { email: string; name?: string | null; role: string }, _client?: unknown) => ({}) as unknown),
    revokeInvite: vi.fn(),
    updateUserRole: vi.fn(),
    setUserActive: vi.fn(),
    getUserById: vi.fn(),
    countActiveAdmins: vi.fn(),
    InviteAlreadyExistsError,
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/guards", () => ({ requireAdmin }));
vi.mock("@/lib/db", () => ({ withTransaction }));
vi.mock("@/lib/repositories/audit-log", () => ({ writeAuditLog }));
vi.mock("@/lib/repositories/app-users", () => ({
  createInvite,
  revokeInvite,
  updateUserRole,
  setUserActive,
  getUserById,
  countActiveAdmins,
  InviteAlreadyExistsError,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  inviteUserAction,
  revokeInviteAction,
  setActiveAction,
  setRoleAction,
} from "@/app/users/actions";
import { initialUsersActionState } from "@/app/users/state";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

function row(over: Partial<AppUserRow> = {}): AppUserRow {
  return {
    id: "u-1",
    uid: "target-uid",
    email: "target@bachmancc.org",
    name: "Target",
    role: "scheduler",
    active: true,
    last_login: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default happy-path mock behaviors cleared above.
  requireAdmin.mockImplementation(async () => ({
    uid: "admin-uid",
    email: "admin@bachmancc.org",
    role: "admin" as const,
  }));
  withTransaction.mockImplementation(
    async (fn: (client: unknown) => unknown) =>
      fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
  );
  writeAuditLog.mockResolvedValue({});
});

const st = initialUsersActionState;

// ---------------------------------------------------------------------------
// Authorization: requireAdmin runs FIRST for every action.
// ---------------------------------------------------------------------------
describe("authorization — requireAdmin throwing propagates for every action", () => {
  const cases: Array<[string, (fd: FormData) => Promise<unknown>, FormData]> = [
    ["inviteUserAction", (fd) => inviteUserAction(st, fd), form({ email: "a@bachmancc.org", role: "scheduler" })],
    ["revokeInviteAction", (fd) => revokeInviteAction(st, fd), form({ id: "u-1" })],
    ["setRoleAction", (fd) => setRoleAction(st, fd), form({ id: "u-1", role: "admin" })],
    ["setActiveAction", (fd) => setActiveAction(st, fd), form({ id: "u-1", active: "false" })],
  ];

  for (const [name, run, fd] of cases) {
    it(`${name} rejects when requireAdmin throws (scheduler/unauth)`, async () => {
      requireAdmin.mockRejectedValueOnce(new Error("Admin role required"));
      await expect(run(fd)).rejects.toThrow("Admin role required");
      // Authorization fires before any DB work.
      expect(createInvite).not.toHaveBeenCalled();
      expect(revokeInvite).not.toHaveBeenCalled();
      expect(updateUserRole).not.toHaveBeenCalled();
      expect(setUserActive).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// inviteUserAction
// ---------------------------------------------------------------------------
describe("inviteUserAction", () => {
  it("valid input → createInvite + audit(user.invite.create), success state", async () => {
    createInvite.mockResolvedValue(row({ id: "inv-1", uid: null, email: "new@bachmancc.org", role: "scheduler" }));
    const result = await inviteUserAction(
      st,
      form({ email: "new@bachmancc.org", name: "New", role: "scheduler" }),
    );
    expect(result.status).toBe("success");
    expect(createInvite).toHaveBeenCalledTimes(1);
    expect(createInvite.mock.calls[0][0]).toMatchObject({
      email: "new@bachmancc.org",
      role: "scheduler",
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "user.invite.create" });
  });

  it("lower-cases + trims the email when passed through to createInvite", async () => {
    createInvite.mockResolvedValue(row({ id: "inv-1", uid: null }));
    await inviteUserAction(st, form({ email: "  MixedCase@BachmanCC.ORG ", role: "admin" }));
    expect(createInvite.mock.calls[0][0].email).toBe("mixedcase@bachmancc.org");
  });

  it("duplicate (InviteAlreadyExistsError) → error state with fieldErrors.email", async () => {
    createInvite.mockRejectedValue(new InviteAlreadyExistsError("dup@bachmancc.org"));
    const result = await inviteUserAction(
      st,
      form({ email: "dup@bachmancc.org", role: "scheduler" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.email).toBeDefined();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("Zod rejects an invalid email → error with fieldErrors.email, no DB write", async () => {
    const result = await inviteUserAction(st, form({ email: "not-an-email", role: "scheduler" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.email).toBeDefined();
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("Zod rejects an invalid role → error, no DB write", async () => {
    const result = await inviteUserAction(st, form({ email: "a@bachmancc.org", role: "superuser" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.role).toBeDefined();
    expect(createInvite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// revokeInviteAction
// ---------------------------------------------------------------------------
describe("revokeInviteAction", () => {
  it("pending row → revokeInvite + audit(user.invite.revoke), success", async () => {
    getUserById.mockResolvedValue(row({ id: "inv-1", uid: null, active: false }));
    revokeInvite.mockResolvedValue(true);
    const result = await revokeInviteAction(st, form({ id: "inv-1" }));
    expect(result.status).toBe("success");
    expect(revokeInvite).toHaveBeenCalledWith("inv-1", expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "user.invite.revoke" });
  });

  it("a bound row (uid != null) → refuses, no delete", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "bound-uid" }));
    const result = await revokeInviteAction(st, form({ id: "u-1" }));
    expect(result.status).toBe("error");
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it("missing id → error, no DB work", async () => {
    const result = await revokeInviteAction(st, form({ id: "" }));
    expect(result.status).toBe("error");
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("unknown id → user-not-found error", async () => {
    getUserById.mockResolvedValue(null);
    const result = await revokeInviteAction(st, form({ id: "ghost" }));
    expect(result.status).toBe("error");
    expect(revokeInvite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setRoleAction
// ---------------------------------------------------------------------------
describe("setRoleAction", () => {
  it("valid change → updateUserRole + audit(user.role.update)", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "scheduler" }));
    updateUserRole.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "admin" }));
    countActiveAdmins.mockResolvedValue(2); // transactional re-check sees admins
    const result = await setRoleAction(st, form({ id: "u-1", role: "admin" }));
    expect(result.status).toBe("success");
    expect(updateUserRole).toHaveBeenCalledWith("target-uid", "admin", expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "user.role.update" });
  });

  it("demote-last-admin pre-check (countActiveAdmins() <= 1) → error, no write", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "only-admin", role: "admin", active: true }));
    countActiveAdmins.mockResolvedValue(1); // pre-check: only one admin
    const result = await setRoleAction(st, form({ id: "u-1", role: "scheduler" }));
    expect(result.status).toBe("error");
    expect(updateUserRole).not.toHaveBeenCalled();
    // Pre-check uses the pool (no client arg).
    expect(countActiveAdmins).toHaveBeenCalledWith();
  });

  it("transactional rollback: updateUserRole succeeds but re-count returns 0 → LastAdminError, nothing committed", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "admin", active: true }));
    updateUserRole.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "scheduler" }));
    // Pre-check passes (two admins), but the in-tx re-count finds zero (a
    // concurrent second demotion). The withTransaction callback must throw.
    countActiveAdmins.mockImplementation(async (client?: unknown) => (client ? 0 : 2));

    // Make the transaction propagate the thrown error so we can assert rollback.
    let threw = false;
    withTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      try {
        return await fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) });
      } catch (e) {
        threw = true;
        throw e;
      }
    });

    const result = await setRoleAction(st, form({ id: "u-1", role: "scheduler" }));
    expect(result.status).toBe("error");
    expect(threw).toBe(true); // callback threw → transaction rolled back
    expect(writeAuditLog).not.toHaveBeenCalled(); // audit never reached
  });

  it("two-admin case → the demotion is allowed", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "admin", active: true }));
    updateUserRole.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "scheduler" }));
    countActiveAdmins.mockResolvedValue(2); // both pre-check and in-tx see 2 → 1
    const result = await setRoleAction(st, form({ id: "u-1", role: "scheduler" }));
    expect(result.status).toBe("success");
    expect(updateUserRole).toHaveBeenCalled();
  });

  it("invalid role → error, no write", async () => {
    const result = await setRoleAction(st, form({ id: "u-1", role: "wizard" }));
    expect(result.status).toBe("error");
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("pending invite (uid null) → refuses (no role to change here)", async () => {
    getUserById.mockResolvedValue(row({ id: "inv-1", uid: null }));
    const result = await setRoleAction(st, form({ id: "inv-1", role: "admin" }));
    expect(result.status).toBe("error");
    expect(updateUserRole).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setActiveAction
// ---------------------------------------------------------------------------
describe("setActiveAction", () => {
  it("deactivate → setUserActive + audit(user.deactivate)", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "scheduler", active: true }));
    setUserActive.mockResolvedValue(row({ id: "u-1", uid: "target-uid", active: false }));
    countActiveAdmins.mockResolvedValue(2);
    const result = await setActiveAction(st, form({ id: "u-1", active: "false" }));
    expect(result.status).toBe("success");
    expect(setUserActive).toHaveBeenCalledWith("target-uid", false, expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "user.deactivate" });
  });

  it("reactivate → audit(user.activate)", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "scheduler", active: false }));
    setUserActive.mockResolvedValue(row({ id: "u-1", uid: "target-uid", active: true }));
    countActiveAdmins.mockResolvedValue(2);
    const result = await setActiveAction(st, form({ id: "u-1", active: "true" }));
    expect(result.status).toBe("success");
    expect(setUserActive).toHaveBeenCalledWith("target-uid", true, expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "user.activate" });
  });

  it("deactivate-last-admin pre-check (<=1) → error, no write", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "only-admin", role: "admin", active: true }));
    countActiveAdmins.mockResolvedValue(1);
    const result = await setActiveAction(st, form({ id: "u-1", active: "false" }));
    expect(result.status).toBe("error");
    expect(setUserActive).not.toHaveBeenCalled();
  });

  it("deactivate-last-admin transactional rollback (in-tx re-count 0) → error, nothing committed", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "admin", active: true }));
    setUserActive.mockResolvedValue(row({ id: "u-1", uid: "target-uid", active: false }));
    countActiveAdmins.mockImplementation(async (client?: unknown) => (client ? 0 : 2));

    let threw = false;
    withTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      try {
        return await fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) });
      } catch (e) {
        threw = true;
        throw e;
      }
    });

    const result = await setActiveAction(st, form({ id: "u-1", active: "false" }));
    expect(result.status).toBe("error");
    expect(threw).toBe(true);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("two-admin case → deactivation allowed", async () => {
    getUserById.mockResolvedValue(row({ id: "u-1", uid: "target-uid", role: "admin", active: true }));
    setUserActive.mockResolvedValue(row({ id: "u-1", uid: "target-uid", active: false }));
    countActiveAdmins.mockResolvedValue(2);
    const result = await setActiveAction(st, form({ id: "u-1", active: "false" }));
    expect(result.status).toBe("success");
    expect(setUserActive).toHaveBeenCalled();
  });

  it("pending invite (uid null) → refuses", async () => {
    getUserById.mockResolvedValue(row({ id: "inv-1", uid: null, active: false }));
    const result = await setActiveAction(st, form({ id: "inv-1", active: "true" }));
    expect(result.status).toBe("error");
    expect(setUserActive).not.toHaveBeenCalled();
  });

  it("invalid active value → error, no DB work", async () => {
    const result = await setActiveAction(st, form({ id: "u-1", active: "maybe" }));
    expect(result.status).toBe("error");
    expect(getUserById).not.toHaveBeenCalled();
  });
});
