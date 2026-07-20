import "server-only";

import { executor, type Queryable } from "./shared";
import type { ReservationSeriesInsert, ReservationSeriesRow } from "./types";

// Repository for the admin-owned `reservation_series` table (spec §5/§9). Holds
// the recurrence rule; occurrences are materialized up-front into groups + rows
// by the booking flow (P2.4 expands the rule, P6.1 writes them). `starts_on` /
// `until_date` are DATEs in Eastern (spec §2) — passed/returned as 'YYYY-MM-DD'.

const SERIES_COLUMNS = `
  id, freq, interval, by_weekday, starts_on, until_date, count, created_by, created_at
`;

export async function createReservationSeries(
  input: ReservationSeriesInsert,
  client?: Queryable,
): Promise<ReservationSeriesRow> {
  const { rows } = await executor(client).query<ReservationSeriesRow>(
    `INSERT INTO reservation_series (
       freq, interval, by_weekday, starts_on, until_date, count, created_by, created_at
     ) VALUES ($1, COALESCE($2, 1), $3, $4, $5, $6, $7, now())
     RETURNING ${SERIES_COLUMNS}`,
    [
      input.freq,
      input.interval ?? null,
      input.by_weekday ?? null,
      input.starts_on,
      input.until_date ?? null,
      input.count ?? null,
      input.created_by ?? null,
    ],
  );
  return rows[0];
}

export async function getReservationSeriesById(
  id: string,
  client?: Queryable,
): Promise<ReservationSeriesRow | null> {
  const { rows } = await executor(client).query<ReservationSeriesRow>(
    `SELECT ${SERIES_COLUMNS} FROM reservation_series WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
