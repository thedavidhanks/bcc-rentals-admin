import "server-only";

import { buildSet, executor, type Queryable } from "./shared";
import type {
  ReservationGroupInsert,
  ReservationGroupRow,
  ReservationGroupUpdate,
} from "./types";

// Repository for the admin-owned `reservation_groups` table (spec §5/§9). One
// group → many `reservations` rows made together. Create the group first, then
// insert its reservation rows (through the race-safe engine) with this group_id.

const GROUP_COLUMNS = `
  id, title, contact_name, contact_email, contact_phone, notes,
  series_id, occurrence_at, created_by, created_at
`;

const GROUP_UPDATE_COLUMNS = [
  "title",
  "contact_name",
  "contact_email",
  "contact_phone",
  "notes",
  "series_id",
  "occurrence_at",
  "created_by",
] as const;

export async function createReservationGroup(
  input: ReservationGroupInsert,
  client?: Queryable,
): Promise<ReservationGroupRow> {
  const { rows } = await executor(client).query<ReservationGroupRow>(
    `INSERT INTO reservation_groups (
       title, contact_name, contact_email, contact_phone, notes,
       series_id, occurrence_at, created_by, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     RETURNING ${GROUP_COLUMNS}`,
    [
      input.title ?? null,
      input.contact_name ?? null,
      input.contact_email ?? null,
      input.contact_phone ?? null,
      input.notes ?? null,
      input.series_id ?? null,
      input.occurrence_at ?? null,
      input.created_by ?? null,
    ],
  );
  return rows[0];
}

export async function getReservationGroupById(
  id: string,
  client?: Queryable,
): Promise<ReservationGroupRow | null> {
  const { rows } = await executor(client).query<ReservationGroupRow>(
    `SELECT ${GROUP_COLUMNS} FROM reservation_groups WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listReservationGroupsBySeries(
  seriesId: string,
  client?: Queryable,
): Promise<ReservationGroupRow[]> {
  const { rows } = await executor(client).query<ReservationGroupRow>(
    `SELECT ${GROUP_COLUMNS} FROM reservation_groups WHERE series_id = $1
     ORDER BY occurrence_at ASC NULLS LAST, created_at ASC`,
    [seriesId],
  );
  return rows;
}

export async function updateReservationGroup(
  id: string,
  patch: ReservationGroupUpdate,
  client?: Queryable,
): Promise<ReservationGroupRow | null> {
  const { clause, values, nextIndex } = buildSet(
    patch as Record<string, unknown>,
    GROUP_UPDATE_COLUMNS,
  );
  if (!clause) return getReservationGroupById(id, client);
  const { rows } = await executor(client).query<ReservationGroupRow>(
    `UPDATE reservation_groups SET ${clause} WHERE id = $${nextIndex}
     RETURNING ${GROUP_COLUMNS}`,
    [...values, id],
  );
  return rows[0] ?? null;
}
