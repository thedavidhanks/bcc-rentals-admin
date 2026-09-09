import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUserRow } from "../lib/repositories/types";

// P11.3 — self-service profile server-action tests (app/profile/actions.ts).
// Mirrors tests/users-actions.test.ts: mock the guard, withTransaction, the
// repo fns, writeAuditLog + next/cache, drive the action with FormData, and
// assert the returned ProfileActionState (or that requireScheduler's
// throw/redirect propagates).
//
// This action exists BECAUSE it is security-critical (spec §3 work order): a
// self-service editor that could write someone else's row, or its own role,
// would be a privilege-escalation bug. Every `it()` below that backs one of
// the five §3 requirements says so explicitly in its name.
//
// Everything referenced inside a vi.mock factory is created via vi.hoisted so
// it exists when the hoisted factories run.
const {
  requireScheduler,
  withTransaction,
  writeAuditLog,
  getUserByUid,
  updateUserName,
  revalidatePath,
} = vi.hoisted(() => {
  return {
    requireScheduler: vi.fn(async () => ({
      uid: "session-uid",
      email: "session@bachmancc.org",
      role: "scheduler" as const,
    })),
    withTransaction: vi.fn(
      async (fn: (client: unknown) => unknown) =>
        fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
    ),
    writeAuditLog: vi.fn(async (_entry: Record<string, unknown>, _client?: unknown) => ({})),
    getUserByUid: vi.fn(),
    updateUserName: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/guards", () => ({ requireScheduler }));
vi.mock("@/lib/db", () => ({ withTransaction }));
vi.mock("@/lib/repositories/audit-log", () => ({ writeAuditLog }));
vi.mock("@/lib/repositories/app-users", () => ({ getUserByUid, updateUserName }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { updateProfileAction } from "@/app/profile/actions";
import { initialProfileActionState } from "@/app/profile/state";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function row(over: Partial<AppUserRow> = {}): AppUserRow {
  return {
    id: "u-1",
    uid: "session-uid",
    email: "session@bachmancc.org",
    name: "Old Name",
    role: "scheduler",
    active: true,
    last_login: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

const st = initialProfileActionState;

beforeEach(() => {
  vi.clearAllMocks();
  requireScheduler.mockImplementation(async () => ({
    uid: "session-uid",
    email: "session@bachmancc.org",
    role: "scheduler" as const,
  }));
  withTransaction.mockImplementation(
    async (fn: (client: unknown) => unknown) =>
      fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
  );
  getUserByUid.mockResolvedValue(row());
  updateUserName.mockResolvedValue(row({ name: "New Name" }));
  writeAuditLog.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// §3.3 — Guard runs before parsing.
// ---------------------------------------------------------------------------
describe("authorization — requireScheduler runs first", () => {
  it("guard runs before parsing: requireScheduler rejecting means no repository call and no audit write", async () => {
    requireScheduler.mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(
      updateProfileAction(st, form({ name: "Someone" })),
    ).rejects.toThrow("REDIRECT:/login");
    expect(getUserByUid).not.toHaveBeenCalled();
    expect(updateUserName).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §3.1 — Never accept a target user identifier from the client.
// ---------------------------------------------------------------------------
describe("uid spoofing resistance", () => {
  it("ignores uid/id/email in the FormData and writes with the SESSION uid only", async () => {
    const result = await updateProfileAction(
      st,
      form({
        name: "New Name",
        uid: "someone-else-uid",
        id: "other-row-id",
        email: "attacker@evil.com",
      }),
    );
    expect(result.status).toBe("success");
    expect(updateUserName).toHaveBeenCalledWith(
      "session-uid",
      "New Name",
      expect.anything(),
    );
    expect(getUserByUid).toHaveBeenCalledWith("session-uid", expect.anything());
    // Never called with the spoofed identifiers.
    expect(updateUserName).not.toHaveBeenCalledWith(
      "someone-else-uid",
      expect.anything(),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// §3.2 — role and active are never written by this path.
// ---------------------------------------------------------------------------
describe("no role/active escalation", () => {
  it("calls updateUserName with only (uid, name, client) — no role/active argument exists to pass", async () => {
    await updateProfileAction(st, form({ name: "New Name" }));
    expect(updateUserName).toHaveBeenCalledTimes(1);
    const call = updateUserName.mock.calls[0];
    expect(call).toHaveLength(3);
    expect(call[0]).toBe("session-uid");
    expect(call[1]).toBe("New Name");
  });
});

// ---------------------------------------------------------------------------
// §3.4 — Every mutation is audited, in the same transaction.
// ---------------------------------------------------------------------------
describe("audit atomicity", () => {
  it("writeAuditLog receives the SAME transaction client passed to updateUserName", async () => {
    await updateProfileAction(st, form({ name: "New Name" }));
    const txClient = updateUserName.mock.calls[0][2];
    const auditClient = writeAuditLog.mock.calls[0][1];
    expect(auditClient).toBe(txClient);
  });

  it("audit entry has action='user.profile.update', entity='app_users', entity_id=row id, before/after name", async () => {
    await updateProfileAction(st, form({ name: "New Name" }));
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      actor_uid: "session-uid",
      actor_email: "session@bachmancc.org",
      action: "user.profile.update",
      entity: "app_users",
      entity_id: "u-1",
      detail: { before: { name: "Old Name" }, after: { name: "New Name" } },
    });
  });

  it("a thrown error inside the transaction (writeAuditLog fails) leaves no partial state: transaction propagates, error state returned", async () => {
    writeAuditLog.mockRejectedValueOnce(new Error("audit write failed"));
    let threw = false;
    withTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      try {
        return await fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) });
      } catch (e) {
        threw = true;
        throw e;
      }
    });

    const result = await updateProfileAction(st, form({ name: "New Name" }));
    expect(result.status).toBe("error");
    expect(threw).toBe(true); // the transaction callback threw -> rollback
  });

  it("updateUserName returning null (no app_users row, e.g. dev-bypass) rolls back and returns a clean error state, no audit write", async () => {
    updateUserName.mockResolvedValue(null);
    let threw = false;
    withTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => {
      try {
        return await fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) });
      } catch (e) {
        threw = true;
        throw e;
      }
    });

    const result = await updateProfileAction(st, form({ name: "New Name" }));
    expect(result.status).toBe("error");
    expect(threw).toBe(true);
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(result.name).toBe("New Name"); // echoed back, field not wiped
  });
});

// ---------------------------------------------------------------------------
// Name validation edge cases.
// ---------------------------------------------------------------------------
describe("name validation", () => {
  it("empty string clears the name to null", async () => {
    await updateProfileAction(st, form({ name: "" }));
    expect(updateUserName).toHaveBeenCalledWith("session-uid", null, expect.anything());
  });

  it("whitespace-only clears the name to null", async () => {
    await updateProfileAction(st, form({ name: "   \t  " }));
    expect(updateUserName).toHaveBeenCalledWith("session-uid", null, expect.anything());
  });

  it("trims surrounding whitespace on a non-empty name", async () => {
    await updateProfileAction(st, form({ name: "  Jane Doe  " }));
    expect(updateUserName).toHaveBeenCalledWith("session-uid", "Jane Doe", expect.anything());
  });

  it("rejects a name over 200 characters — error state, no DB write", async () => {
    const tooLong = "a".repeat(201);
    const result = await updateProfileAction(st, form({ name: tooLong }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toBeDefined();
    expect(updateUserName).not.toHaveBeenCalled();
    // Echoes the submitted (too-long) value back so the field isn't wiped.
    expect(result.name).toBe(tooLong);
  });

  it("accepts a name at exactly 200 characters", async () => {
    const exactly200 = "a".repeat(200);
    const result = await updateProfileAction(st, form({ name: exactly200 }));
    expect(result.status).toBe("success");
    expect(updateUserName).toHaveBeenCalledWith("session-uid", exactly200, expect.anything());
  });

  it("accepts and preserves unicode characters", async () => {
    const unicodeName = "José 田中 🎉";
    await updateProfileAction(st, form({ name: unicodeName }));
    expect(updateUserName).toHaveBeenCalledWith("session-uid", unicodeName, expect.anything());
  });

  it("missing name field is treated as empty → clears to null", async () => {
    await updateProfileAction(st, form({}));
    expect(updateUserName).toHaveBeenCalledWith("session-uid", null, expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Success path / revalidation / echo-back.
// ---------------------------------------------------------------------------
describe("updateProfileAction — success path", () => {
  it("revalidates /profile and the root layout (so the account-menu monogram refreshes)", async () => {
    await updateProfileAction(st, form({ name: "New Name" }));
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns a success state with the saved name", async () => {
    const result = await updateProfileAction(st, form({ name: "New Name" }));
    expect(result.status).toBe("success");
    expect(result.name).toBe("New Name");
  });
});

describe("updateProfileAction — failure echoes the submitted name back", () => {
  it("does not revalidate on a DB error, and echoes the submitted name", async () => {
    updateUserName.mockRejectedValue(new Error("db exploded"));
    const result = await updateProfileAction(st, form({ name: "Attempted Name" }));
    expect(result.status).toBe("error");
    expect(result.name).toBe("Attempted Name");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
