import { beforeEach, describe, expect, it, vi } from "vitest";

// Edit Reservation server-action tests (execution-plan P6.2, Slice D).
//
// Slice B owns app/reservations/[groupId]/actions.ts; it is NOT in this
// worktree until integration. These tests are written against the documented
// Slice B signatures and the Slice A contract (types.ts) so they run GREEN the
// moment actions.ts lands. Until then the dynamic import below throws and the
// whole file is skipped (see the top-level guard) — vitest still collects and
// runs the rest of the suite.
//
// Mocking strategy: the edit actions compose the repository + scheduler
// COLLABORATORS (cancelReservationsByGroup / cancelReservationsBySeries /
// updateReservationContact / updateReservationGroup / scheduler.createBooking /
// writeAuditLog) inside a single withTransaction. We mock those seams (not raw
// SQL) so we can assert call order, same-transaction-client, and args precisely
// — the same approach tests/add-reservation-action.test.ts uses for the pg
// seam, one level up. requireScheduler, next/cache, next/navigation are stubbed
// exactly as in the P6.1 action suite (redirect throws a NEXT_REDIRECT sentinel).

// -------------------------------------------------------------------------
// Hoisted mocks (must exist before the vi.mock factories run). Everything a
// vi.mock factory closes over is created here in one vi.hoisted block.
// -------------------------------------------------------------------------
const {
  txClient,
  callOrder,
  withTransaction,
  requireScheduler,
  getReservationGroupById,
  cancelReservationsByGroup,
  cancelReservationsBySeries,
  updateReservationContact,
  updateReservationGroup,
  createBooking,
  writeAuditLog,
  listItems,
  revalidatePath,
  redirect,
  RedirectSignal,
} = vi.hoisted(() => {
  class RedirectSignal extends Error {
    digest: string;
    constructor(path: string) {
      super(`NEXT_REDIRECT;${path}`);
      this.digest = `NEXT_REDIRECT;replace;${path};307;`;
    }
  }
  // A sentinel client object so we can assert every collaborator ran on the
  // SAME transaction client (proving one-transaction atomicity).
  const txClient = {
    query: vi.fn<(...a: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>(
      async () => ({ rows: [], rowCount: 0 }),
    ),
  };
  // callOrder records the sequence of collaborator invocations so we can prove
  // cancel-then-rebook-then-audit ordering.
  const callOrder: string[] = [];
  const record = (name: string) => callOrder.push(name);
  // Collaborator mocks are typed as `(...a: unknown[]) => Promise<...>` so
  // `.mock.calls[i][j]` is indexable (we assert on the args the action passed —
  // e.g. the transaction client, the booking input). Return shapes mirror the
  // real repo/scheduler signatures closely enough for the action under test.
  return {
    txClient,
    callOrder,
    withTransaction: vi.fn(
      async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient),
    ),
    requireScheduler: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
      uid: "uid-scheduler",
      email: "sched@bachmancc.org",
      role: "scheduler" as const,
    })),
    getReservationGroupById: vi.fn<(...a: unknown[]) => Promise<unknown>>(
      async () => ({
        id: "group-uuid",
        title: "Old Title",
        contact_name: "Old Name",
        contact_email: "old@bachmancc.org",
        contact_phone: "555-1111",
        notes: "old notes",
        series_id: null as string | null,
        occurrence_at: new Date("2026-08-05T13:00:00.000Z"),
        created_by: "uid-scheduler",
        created_at: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ),
    cancelReservationsByGroup: vi.fn<(...a: unknown[]) => Promise<number>>(
      async () => {
        record("cancelReservationsByGroup");
        return 2;
      },
    ),
    cancelReservationsBySeries: vi.fn<(...a: unknown[]) => Promise<number>>(
      async () => {
        record("cancelReservationsBySeries");
        return 5;
      },
    ),
    updateReservationContact: vi.fn<(...a: unknown[]) => Promise<unknown>>(
      async () => {
        record("updateReservationContact");
        return null;
      },
    ),
    updateReservationGroup: vi.fn<(...a: unknown[]) => Promise<unknown>>(
      async () => {
        record("updateReservationGroup");
        return null;
      },
    ),
    createBooking: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => {
      record("createBooking");
      return {
        groups: [
          { id: "new-group-uuid", occurrenceKey: "2026-08-05", reservations: [{}] },
        ],
        reservationCount: 1,
      };
    }),
    writeAuditLog: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => {
      record("writeAuditLog");
      return { id: "audit-uuid" };
    }),
    listItems: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => [
      { slug: "auditorium", name: "Auditorium" },
      { slug: "chairs", name: "Chairs" },
    ]),
    revalidatePath: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new RedirectSignal(path);
    }),
    RedirectSignal,
  };
});

vi.mock("@/lib/db", () => ({
  getPool: () => ({ query: vi.fn() }),
  withTransaction,
}));

vi.mock("@/lib/auth/guards", () => ({ requireScheduler }));

vi.mock("@/lib/repositories/reservations", () => ({
  cancelReservationsByGroup,
  cancelReservationsBySeries,
  updateReservationContact,
  // The loader (imported transitively by some flows) also references these;
  // provide inert stubs so the module surface is complete.
  listReservationsByGroup: vi.fn(async () => []),
  listReservationsBySeries: vi.fn(async () => []),
  getReservationById: vi.fn(async () => null),
}));

vi.mock("@/lib/repositories/reservation-groups", () => ({
  updateReservationGroup,
  getReservationGroupById,
  listReservationGroupsBySeries: vi.fn(async () => []),
}));

vi.mock("@/lib/repositories/reservation-series", () => ({
  getReservationSeriesById: vi.fn(async () => null),
}));

vi.mock("@/lib/repositories/audit-log", () => ({ writeAuditLog }));

vi.mock("@/lib/repositories/items", () => ({ listItems }));

vi.mock("@/lib/scheduler/client", () => ({ scheduler: { createBooking } }));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

import { GroupBookingConflictError } from "@/lib/scheduler/errors";
import type { EditReservationState } from "@/app/reservations/[groupId]/types";

// -------------------------------------------------------------------------
// Lazy loader for the Slice B module (absent until integration). If it can't
// be imported yet, we describe.skip the whole suite with a clear reason.
// -------------------------------------------------------------------------
type EditActions = typeof import("@/app/reservations/[groupId]/actions");
let actions: EditActions | undefined;
try {
  actions = await import("@/app/reservations/[groupId]/actions");
} catch {
  actions = undefined;
}

const describeIf = actions ? describe : describe.skip;

const IDLE: EditReservationState = { status: "idle" };

/** Build a FormData from a flat field map (arrays append; scalars set). */
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

const ONE_LINE = {
  groupId: "group-uuid",
  "line-0-itemSlug": "auditorium",
  "line-0-quantity": "1",
  "line-0-date": "2026-08-05",
  "line-0-startMinute": "09:00",
  "line-0-endMinute": "12:00",
};

const CONTACT_FIELDS = {
  groupId: "group-uuid",
  title: "New Title",
  contactName: "Jane Booker",
  contactEmail: "jane@bachmancc.org",
  contactPhone: "555-2222",
  notes: "please deliver early",
};

beforeEach(() => {
  callOrder.length = 0;
  withTransaction.mockClear();
  txClient.query.mockClear();
  requireScheduler.mockClear();
  cancelReservationsByGroup.mockClear();
  cancelReservationsBySeries.mockClear();
  updateReservationContact.mockClear();
  updateReservationGroup.mockClear();
  createBooking.mockClear();
  writeAuditLog.mockClear();
  listItems.mockClear();
  revalidatePath.mockClear();
  redirect.mockClear();
  getReservationGroupById.mockClear();

  // Default group: a one-off (no series). Individual tests override as needed.
  getReservationGroupById.mockResolvedValue({
    id: "group-uuid",
    title: "Old Title",
    contact_name: "Old Name",
    contact_email: "old@bachmancc.org",
    contact_phone: "555-1111",
    notes: "old notes",
    series_id: null,
    occurrence_at: new Date("2026-08-05T13:00:00.000Z"),
    created_by: "uid-scheduler",
    created_at: new Date("2026-07-01T00:00:00.000Z"),
  });

  createBooking.mockImplementation(async () => {
    callOrder.push("createBooking");
    return {
      groups: [
        { id: "new-group-uuid", occurrenceKey: "2026-08-05", reservations: [{}] },
      ],
      reservationCount: 1,
    };
  });
});

// =========================================================================
// 1. Contact / notes edit — no capacity engine
// =========================================================================
describeIf("updateContactAction — contact/notes edit (no capacity)", () => {
  it("updates the group/reservation rows and writes an audit row", async () => {
    const state = await actions!
      .updateContactAction(IDLE, form(CONTACT_FIELDS))
      .catch((e: unknown) => e);

    // Not an error state (may be a success state or a redirect signal).
    if (state instanceof Error) {
      expect(state).toBeInstanceOf(RedirectSignal);
    } else {
      expect((state as EditReservationState).status).not.toBe("error");
    }

    // Contact edit touches the group and/or reservation contact rows.
    const touchedGroup = updateReservationGroup.mock.calls.length > 0;
    const touchedContact = updateReservationContact.mock.calls.length > 0;
    expect(touchedGroup || touchedContact).toBe(true);

    // An audit row is written.
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const auditEntry = writeAuditLog.mock.calls[0][0] as {
      actor_uid: string;
      action: string;
    };
    expect(auditEntry.actor_uid).toBe("uid-scheduler");
    expect(auditEntry.action).toBe("reservation.update_contact");
  });

  it("MUST NOT call the booking engine for a contact-only edit", async () => {
    await actions!
      .updateContactAction(IDLE, form(CONTACT_FIELDS))
      .catch(() => undefined);
    expect(createBooking).not.toHaveBeenCalled();
    expect(cancelReservationsByGroup).not.toHaveBeenCalled();
  });

  it("runs the mutation and its audit inside one transaction", async () => {
    await actions!
      .updateContactAction(IDLE, form(CONTACT_FIELDS))
      .catch(() => undefined);
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 2. Line / date / time edit — cancel-then-rebook
// =========================================================================
describeIf("editLinesAction — cancel-then-rebook (capacity)", () => {
  it("happy path: cancels the old group, rebooks, and audits in order, one txn", async () => {
    const state = await actions!
      .editLinesAction(IDLE, form(ONE_LINE))
      .catch((e: unknown) => e);

    // Success either returns a success state or redirects — never an error.
    if (state instanceof Error) {
      expect(state).toBeInstanceOf(RedirectSignal);
    } else {
      expect((state as EditReservationState).status).not.toBe("error");
    }

    expect(cancelReservationsByGroup).toHaveBeenCalledTimes(1);
    expect(cancelReservationsByGroup).toHaveBeenCalledWith(
      "group-uuid",
      txClient,
    );
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);

    // Cancel MUST precede rebook (frees capacity so the recheck sees it), and
    // both precede the audit — all-or-nothing in one transaction.
    const cancelIdx = callOrder.indexOf("cancelReservationsByGroup");
    const bookIdx = callOrder.indexOf("createBooking");
    const auditIdx = callOrder.indexOf("writeAuditLog");
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    expect(cancelIdx).toBeLessThan(bookIdx);
    expect(bookIdx).toBeLessThan(auditIdx);

    // Exactly one transaction wraps the whole operation.
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it("routes createBooking through the SAME transaction client as the cancel", async () => {
    await actions!.editLinesAction(IDLE, form(ONE_LINE)).catch(() => undefined);
    // scheduler.createBooking is called with (input, client) — the txClient.
    const [, bookingClient] = createBooking.mock.calls[0];
    expect(bookingClient).toBe(txClient);
    const [, cancelClient] = cancelReservationsByGroup.mock.calls[0];
    expect(cancelClient).toBe(txClient);
  });

  it("moving to a window WITH capacity succeeds and writes the new line", async () => {
    const state = await actions!
      .editLinesAction(
        IDLE,
        form({ ...ONE_LINE, "line-0-date": "2026-08-06" }),
      )
      .catch((e: unknown) => e);

    if (state instanceof Error) {
      expect(state).toBeInstanceOf(RedirectSignal);
    } else {
      expect((state as EditReservationState).status).not.toBe("error");
    }
    expect(createBooking).toHaveBeenCalledTimes(1);
    // The rebooked group carries the new date.
    const [bookingInput] = createBooking.mock.calls[0] as [
      { groups: Array<{ lines: Array<{ startISO: string }> }> },
    ];
    expect(bookingInput.groups).toHaveLength(1);
    expect(bookingInput.groups[0].lines[0].startISO).toContain("2026-08-06");
  });

  it("moving to a FULL window: conflict rolls back, nothing changed, conflicts returned", async () => {
    // The scheduler rejects with an all-or-nothing group conflict; the action's
    // withTransaction propagates the throw, so the transaction rolls back and no
    // audit is committed. The action catches it and returns a conflict state.
    createBooking.mockImplementationOnce(async () => {
      callOrder.push("createBooking");
      throw new GroupBookingConflictError([
        {
          itemSlug: "auditorium",
          occurrenceKey: "2026-08-05",
          startISO: "2026-08-05T13:00:00.000Z",
          endISO: "2026-08-05T16:00:00.000Z",
          requested: 1,
          available: 0,
        },
      ]);
    });

    const state = await actions!.editLinesAction(IDLE, form(ONE_LINE));

    // No redirect (the action returned a state object, not a NEXT_REDIRECT).
    expect(redirect).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
    expect(state.conflicts).toBeDefined();
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts![0]).toMatchObject({
      itemSlug: "auditorium",
      date: "2026-08-05",
      requested: 1,
      available: 0,
    });

    // The cancel DID run (inside the txn) but the transaction rolls back, so the
    // net effect is nothing changed — crucially, NO audit row was committed.
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("editing one occurrence of a series preserves the series_id on the rebook", async () => {
    getReservationGroupById.mockResolvedValueOnce({
      id: "group-uuid",
      title: "Old Title",
      contact_name: "Old Name",
      contact_email: "old@bachmancc.org",
      contact_phone: "555-1111",
      notes: "old notes",
      series_id: "series-uuid-123",
      occurrence_at: new Date("2026-08-05T13:00:00.000Z"),
      created_by: "uid-scheduler",
      created_at: new Date("2026-07-01T00:00:00.000Z"),
    });

    await actions!.editLinesAction(IDLE, form(ONE_LINE)).catch(() => undefined);

    expect(createBooking).toHaveBeenCalledTimes(1);
    const [bookingInput] = createBooking.mock.calls[0] as [
      { seriesId?: string },
    ];
    expect(bookingInput.seriesId).toBe("series-uuid-123");
  });
});

// =========================================================================
// 3 & 4. Delete / cancel — the two modes
// =========================================================================
describeIf("deleteReservationAction — cancel modes (never DELETE)", () => {
  it("mode=instance cancels only this group's rows (status='cancelled') and audits", async () => {
    const state = await actions!
      .deleteReservationAction(
        IDLE,
        form({ groupId: "group-uuid", mode: "instance" }),
      )
      .catch((e: unknown) => e);

    if (state instanceof Error) {
      expect(state).toBeInstanceOf(RedirectSignal);
    } else {
      expect((state as EditReservationState).status).not.toBe("error");
    }

    expect(cancelReservationsByGroup).toHaveBeenCalledTimes(1);
    expect(cancelReservationsByGroup).toHaveBeenCalledWith("group-uuid", txClient);
    expect(cancelReservationsBySeries).not.toHaveBeenCalled();

    // Cancel = status update, never a DELETE. No collaborator issues a DELETE,
    // and no raw DELETE SQL is sent on the transaction client.
    const rawSql = txClient.query.mock.calls.map((c) => String(c[0]));
    expect(rawSql.some((s) => /\bDELETE\b/i.test(s))).toBe(false);

    // Audited.
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const auditEntry = writeAuditLog.mock.calls[0][0] as { action: string };
    expect(auditEntry.action).toBe("reservation.cancel");
  });

  it("mode=series cancels the whole series (future-only default) and audits", async () => {
    getReservationGroupById.mockResolvedValueOnce({
      id: "group-uuid",
      title: "Old Title",
      contact_name: "Old Name",
      contact_email: "old@bachmancc.org",
      contact_phone: "555-1111",
      notes: "old notes",
      series_id: "series-uuid-123",
      occurrence_at: new Date("2026-08-05T13:00:00.000Z"),
      created_by: "uid-scheduler",
      created_at: new Date("2026-07-01T00:00:00.000Z"),
    });

    const state = await actions!
      .deleteReservationAction(
        IDLE,
        form({ groupId: "group-uuid", mode: "series" }),
      )
      .catch((e: unknown) => e);

    if (state instanceof Error) {
      expect(state).toBeInstanceOf(RedirectSignal);
    } else {
      expect((state as EditReservationState).status).not.toBe("error");
    }

    expect(cancelReservationsBySeries).toHaveBeenCalledTimes(1);
    // future-only default: the series id is passed, plus an opts object and the
    // transaction client. Assert the series id + client; opts is future-only.
    const seriesCall = cancelReservationsBySeries.mock.calls[0];
    expect(seriesCall[0]).toBe("series-uuid-123");
    expect(seriesCall[seriesCall.length - 1]).toBe(txClient);
    expect(cancelReservationsByGroup).not.toHaveBeenCalled();

    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(
      (writeAuditLog.mock.calls[0][0] as { action: string }).action,
    ).toBe("reservation.cancel");
  });

  it("mode=series on a one-off (no series_id) errors and mutates nothing", async () => {
    // Default group fixture has series_id = null.
    const state = await actions!.deleteReservationAction(
      IDLE,
      form({ groupId: "group-uuid", mode: "series" }),
    );

    expect(state.status).toBe("error");
    expect(cancelReservationsBySeries).not.toHaveBeenCalled();
    expect(cancelReservationsByGroup).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 5. Authorization — every action denies an unauthorized caller server-side
// =========================================================================
describeIf("authorization — requireScheduler guards every action", () => {
  class RedirectToLogin extends Error {
    digest = "NEXT_REDIRECT;replace;/login;307;";
    constructor() {
      super("NEXT_REDIRECT;/login");
    }
  }

  it("updateContactAction is denied when requireScheduler throws", async () => {
    requireScheduler.mockRejectedValueOnce(new RedirectToLogin());
    await expect(
      actions!.updateContactAction(IDLE, form(CONTACT_FIELDS)),
    ).rejects.toBeInstanceOf(RedirectToLogin);
    // Guard ran first — no mutation happened.
    expect(updateReservationGroup).not.toHaveBeenCalled();
    expect(updateReservationContact).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("editLinesAction is denied when requireScheduler throws", async () => {
    requireScheduler.mockRejectedValueOnce(new RedirectToLogin());
    await expect(
      actions!.editLinesAction(IDLE, form(ONE_LINE)),
    ).rejects.toBeInstanceOf(RedirectToLogin);
    expect(cancelReservationsByGroup).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("deleteReservationAction is denied when requireScheduler throws", async () => {
    requireScheduler.mockRejectedValueOnce(new RedirectToLogin());
    await expect(
      actions!.deleteReservationAction(
        IDLE,
        form({ groupId: "group-uuid", mode: "instance" }),
      ),
    ).rejects.toBeInstanceOf(RedirectToLogin);
    expect(cancelReservationsByGroup).not.toHaveBeenCalled();
    expect(cancelReservationsBySeries).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 6. Zod validation — bad input is rejected with fieldErrors, no mutation
// =========================================================================
describeIf("editLinesAction / updateContactAction — Zod validation", () => {
  it("rejects an invalid contact email with no mutation", async () => {
    const state = await actions!.updateContactAction(
      IDLE,
      form({ ...CONTACT_FIELDS, contactEmail: "not-an-email" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors).toBeDefined();
    expect(updateReservationGroup).not.toHaveBeenCalled();
    expect(updateReservationContact).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects end <= start on a line edit", async () => {
    const state = await actions!.editLinesAction(
      IDLE,
      form({ ...ONE_LINE, "line-0-startMinute": "12:00", "line-0-endMinute": "09:00" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors).toBeDefined();
    expect(createBooking).not.toHaveBeenCalled();
    expect(cancelReservationsByGroup).not.toHaveBeenCalled();
  });

  it("rejects a malformed (out-of-range) time value", async () => {
    const state = await actions!.editLinesAction(
      IDLE,
      form({ ...ONE_LINE, "line-0-startMinute": "25:00" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors).toBeDefined();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("rejects an empty line set (no line-* fields present)", async () => {
    const state = await actions!.editLinesAction(
      IDLE,
      form({ groupId: "group-uuid" }),
    );
    expect(state.status).toBe("error");
    expect(createBooking).not.toHaveBeenCalled();
    expect(cancelReservationsByGroup).not.toHaveBeenCalled();
  });

  it("rejects a missing required item slug", async () => {
    const state = await actions!.editLinesAction(
      IDLE,
      form({ ...ONE_LINE, "line-0-itemSlug": "" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors).toBeDefined();
    expect(createBooking).not.toHaveBeenCalled();
  });
});
