import { beforeEach, describe, expect, it, vi } from "vitest";

// Edit Reservation loader tests (execution-plan P6.2, Slice A contract, Slice D
// tests). The loader (app/reservations/[groupId]/loader.ts) is the read path the
// edit PAGE calls. It dynamic-import()s the repositories, so we mock those repo
// modules and drive the loader's branching:
//   • group miss  → returns null (the page then calls notFound()),
//   • one-off      → series === null, no series reservations,
//   • series       → series row + its reservations loaded,
//   • itemSlugById → built from the FULL catalog (inactive items resolve too).
//
// Loader is present in THIS worktree (Slice A landed), so this file runs green in
// isolation — no dependency on Slice B.

const {
  getReservationGroupById,
  listReservationsByGroup,
  listReservationsBySeries,
  getReservationSeriesById,
  listItems,
} = vi.hoisted(() => ({
  // Typed loosely (args/return `any`) so the loader's dynamic-imported repo
  // functions accept our fixture rows without dragging in every column of the
  // real row types — these are test doubles, not the production repos.
  getReservationGroupById: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
  listReservationsByGroup: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(
    async () => [],
  ),
  listReservationsBySeries: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(
    async () => [],
  ),
  getReservationSeriesById: vi.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
  listItems: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
}));

vi.mock("@/lib/repositories/reservation-groups", () => ({
  getReservationGroupById,
}));
vi.mock("@/lib/repositories/reservations", () => ({
  listReservationsByGroup,
  listReservationsBySeries,
}));
vi.mock("@/lib/repositories/reservation-series", () => ({
  getReservationSeriesById,
}));
vi.mock("@/lib/repositories/items", () => ({ listItems }));

import { loadReservationForEdit } from "@/app/reservations/[groupId]/loader";

const D = (iso: string) => new Date(iso);

function groupRow(over: Record<string, unknown> = {}) {
  return {
    id: "group-uuid",
    title: "Team Meeting",
    contact_name: "Jane",
    contact_email: "jane@bachmancc.org",
    contact_phone: "555-1111",
    notes: "n",
    series_id: null,
    occurrence_at: D("2026-08-05T13:00:00.000Z"),
    created_by: "uid-scheduler",
    created_at: D("2026-07-01T00:00:00.000Z"),
    ...over,
  };
}

function itemRow(id: string, slug: string, active: boolean) {
  return {
    id,
    slug,
    name: slug.toUpperCase(),
    active,
    total_stock: 1,
    buffer_minutes: 0,
    sort_order: 0,
  };
}

beforeEach(() => {
  getReservationGroupById.mockReset();
  listReservationsByGroup.mockReset().mockResolvedValue([]);
  listReservationsBySeries.mockReset().mockResolvedValue([]);
  getReservationSeriesById.mockReset().mockResolvedValue(null);
  listItems.mockReset();

  // listItems(opts): activeOnly → active catalog; no opts → full catalog.
  listItems.mockImplementation(async (...args: unknown[]) => {
    const opts = args[0] as { activeOnly?: boolean } | undefined;
    const all = [
      itemRow("id-aud", "auditorium", true),
      itemRow("id-chairs", "chairs", true),
      itemRow("id-tent", "tent", false), // inactive
    ];
    return opts?.activeOnly ? all.filter((i) => i.active) : all;
  });
});

describe("loadReservationForEdit — group miss", () => {
  it("returns null when the group_id does not exist (page → notFound())", async () => {
    getReservationGroupById.mockResolvedValue(null);

    const loaded = await loadReservationForEdit("does-not-exist");

    expect(loaded).toBeNull();
    // Short-circuits: never queries reservations/series on a miss.
    expect(listReservationsByGroup).not.toHaveBeenCalled();
    expect(getReservationSeriesById).not.toHaveBeenCalled();
  });
});

describe("loadReservationForEdit — one-off booking (no series)", () => {
  it("loads the group + its reservation rows, with series === null", async () => {
    getReservationGroupById.mockResolvedValue(groupRow({ series_id: null }));
    listReservationsByGroup.mockResolvedValue([
      { id: "r1", item_id: "id-aud", group_id: "group-uuid", series_id: null },
    ]);

    const loaded = await loadReservationForEdit("group-uuid");

    expect(loaded).not.toBeNull();
    expect(loaded!.group.id).toBe("group-uuid");
    expect(loaded!.reservations).toHaveLength(1);
    expect(loaded!.series).toBeNull();
    expect(loaded!.seriesReservations).toEqual([]);
    // No series lookups for a one-off.
    expect(getReservationSeriesById).not.toHaveBeenCalled();
    expect(listReservationsBySeries).not.toHaveBeenCalled();
  });
});

describe("loadReservationForEdit — series booking", () => {
  it("loads the series row + all series reservations when the group has a series_id", async () => {
    getReservationGroupById.mockResolvedValue(
      groupRow({ series_id: "series-uuid" }),
    );
    listReservationsByGroup.mockResolvedValue([
      { id: "r1", item_id: "id-aud", group_id: "group-uuid", series_id: "series-uuid" },
    ]);
    getReservationSeriesById.mockResolvedValue({
      id: "series-uuid",
      freq: "weekly",
      interval: 1,
      by_weekday: [2],
      starts_on: "2026-08-05",
      until_date: null,
      count: 4,
      created_by: "uid-scheduler",
      created_at: D("2026-07-01T00:00:00.000Z"),
    });
    listReservationsBySeries.mockResolvedValue([
      { id: "r1", series_id: "series-uuid" },
      { id: "r2", series_id: "series-uuid" },
      { id: "r3", series_id: "series-uuid" },
    ]);

    const loaded = await loadReservationForEdit("group-uuid");

    expect(loaded!.series).not.toBeNull();
    expect(loaded!.series!.id).toBe("series-uuid");
    expect(loaded!.seriesReservations).toHaveLength(3);
    expect(getReservationSeriesById).toHaveBeenCalledWith("series-uuid");
    expect(listReservationsBySeries).toHaveBeenCalledWith("series-uuid");
  });
});

describe("loadReservationForEdit — catalog resolution", () => {
  it("builds itemSlugById from the FULL catalog (inactive items resolve too)", async () => {
    getReservationGroupById.mockResolvedValue(groupRow());

    const loaded = await loadReservationForEdit("group-uuid");

    // Active-only dropdown excludes the inactive 'tent'.
    expect(loaded!.items.map((i) => i.slug)).toEqual(["auditorium", "chairs"]);
    // id→slug map spans the FULL catalog so a booking on an inactive item still
    // resolves its slug for display/edit.
    expect(loaded!.itemSlugById).toMatchObject({
      "id-aud": "auditorium",
      "id-chairs": "chairs",
      "id-tent": "tent",
    });
  });
});
