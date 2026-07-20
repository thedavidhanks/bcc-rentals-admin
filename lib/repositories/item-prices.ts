import "server-only";

import { buildSet, executor, type Queryable } from "./shared";
import type { ItemPriceInsert, ItemPriceRow, ItemPriceUpdate } from "./types";

// Repository for the shared `item_prices` table (spec §4/§6). Money is integer
// cents. Times are Eastern minutes-since-midnight (0–1440), both-or-neither.
// Rows may be hard-deleted here (they carry no historical FK); the caller is
// responsible for the §6 "keep one all-days/all-hours base row" warning.
//
// TODO(P9): consolidate — mirrors the storefront's price row shape.

const PRICE_COLUMNS = `
  id, item_id, price_cents, days_of_week, start_minute, end_minute,
  priority, label, created_at, updated_at
`;

const PRICE_UPDATE_COLUMNS = [
  "price_cents",
  "days_of_week",
  "start_minute",
  "end_minute",
  "priority",
  "label",
] as const;

/** All price rows for an item, highest priority first. */
export async function listPricesForItem(
  itemId: string,
  client?: Queryable,
): Promise<ItemPriceRow[]> {
  const { rows } = await executor(client).query<ItemPriceRow>(
    `SELECT ${PRICE_COLUMNS} FROM item_prices WHERE item_id = $1
     ORDER BY priority DESC, created_at ASC`,
    [itemId],
  );
  return rows;
}

export async function getPriceById(
  id: string,
  client?: Queryable,
): Promise<ItemPriceRow | null> {
  const { rows } = await executor(client).query<ItemPriceRow>(
    `SELECT ${PRICE_COLUMNS} FROM item_prices WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createPrice(
  input: ItemPriceInsert,
  client?: Queryable,
): Promise<ItemPriceRow> {
  const { rows } = await executor(client).query<ItemPriceRow>(
    `INSERT INTO item_prices (
       item_id, price_cents, days_of_week, start_minute, end_minute, priority, label,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $7, now(), now())
     RETURNING ${PRICE_COLUMNS}`,
    [
      input.item_id,
      input.price_cents,
      input.days_of_week ?? null,
      input.start_minute ?? null,
      input.end_minute ?? null,
      input.priority ?? null,
      input.label ?? null,
    ],
  );
  return rows[0];
}

export async function updatePrice(
  id: string,
  patch: ItemPriceUpdate,
  client?: Queryable,
): Promise<ItemPriceRow | null> {
  const { clause, values, nextIndex } = buildSet(
    patch as Record<string, unknown>,
    PRICE_UPDATE_COLUMNS,
  );
  const setClause = clause ? `${clause}, updated_at = now()` : "updated_at = now()";
  const { rows } = await executor(client).query<ItemPriceRow>(
    `UPDATE item_prices SET ${setClause} WHERE id = $${nextIndex}
     RETURNING ${PRICE_COLUMNS}`,
    [...values, id],
  );
  return rows[0] ?? null;
}

export async function deletePrice(
  id: string,
  client?: Queryable,
): Promise<boolean> {
  const { rowCount } = await executor(client).query(
    `DELETE FROM item_prices WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}
