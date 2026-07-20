import "server-only";

import { buildSet, executor, type Queryable } from "./shared";
import type { ItemInsert, ItemRow, ItemUpdate } from "./types";

// Repository for the shared `items` table (spec §4). Deactivate-don't-delete:
// updates set `updated_at = now()`; "deletion" is `active = false`.
//
// TODO(P9): consolidate — mirrors the storefront's item row shape; hoist into
// the shared package rather than maintaining two copies.

const ITEM_COLUMNS = `
  id, slug, name, type, total_stock, active, short_description, long_description,
  highlights, image, pricing_unit, min_minutes, max_minutes, buffer_minutes,
  lead_hours, horizon_days, available_hours, resource_id, sort_order, updated_at
`;

// Columns a caller may set on update (slug included; storefront allows re-slug).
const ITEM_UPDATE_COLUMNS = [
  "slug",
  "name",
  "type",
  "total_stock",
  "active",
  "short_description",
  "long_description",
  "highlights",
  "image",
  "pricing_unit",
  "min_minutes",
  "max_minutes",
  "buffer_minutes",
  "lead_hours",
  "horizon_days",
  "available_hours",
  "resource_id",
  "sort_order",
] as const;

/** List items, newest sort_order first. `activeOnly` restricts to active=true. */
export async function listItems(
  opts: { activeOnly?: boolean } = {},
  client?: Queryable,
): Promise<ItemRow[]> {
  const where = opts.activeOnly ? "WHERE active = true" : "";
  const { rows } = await executor(client).query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM items ${where} ORDER BY sort_order ASC, name ASC`,
  );
  return rows;
}

export async function getItemById(
  id: string,
  client?: Queryable,
): Promise<ItemRow | null> {
  const { rows } = await executor(client).query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getItemBySlug(
  slug: string,
  client?: Queryable,
): Promise<ItemRow | null> {
  const { rows } = await executor(client).query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM items WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function createItem(
  input: ItemInsert,
  client?: Queryable,
): Promise<ItemRow> {
  const { rows } = await executor(client).query<ItemRow>(
    `INSERT INTO items (
       slug, name, type, total_stock, active, short_description, long_description,
       highlights, image, pricing_unit, min_minutes, max_minutes, buffer_minutes,
       lead_hours, horizon_days, available_hours, resource_id, sort_order, updated_at
     ) VALUES (
       $1, $2, $3, $4, COALESCE($5, true), $6, $7,
       $8, $9, $10, $11, $12, COALESCE($13, 0),
       COALESCE($14, 0), COALESCE($15, 365), $16, $17, COALESCE($18, 0), now()
     )
     RETURNING ${ITEM_COLUMNS}`,
    [
      input.slug,
      input.name,
      input.type,
      input.total_stock,
      input.active ?? null,
      input.short_description ?? null,
      input.long_description ?? null,
      input.highlights ?? null,
      input.image ?? null,
      input.pricing_unit,
      input.min_minutes ?? null,
      input.max_minutes ?? null,
      input.buffer_minutes ?? null,
      input.lead_hours ?? null,
      input.horizon_days ?? null,
      input.available_hours ?? null,
      input.resource_id ?? null,
      input.sort_order ?? null,
    ],
  );
  return rows[0];
}

/** Patch an item. Always bumps `updated_at = now()` (spec §4). */
export async function updateItem(
  id: string,
  patch: ItemUpdate,
  client?: Queryable,
): Promise<ItemRow | null> {
  const { clause, values, nextIndex } = buildSet(
    patch as Record<string, unknown>,
    ITEM_UPDATE_COLUMNS,
  );
  const setClause = clause ? `${clause}, updated_at = now()` : "updated_at = now()";
  const { rows } = await executor(client).query<ItemRow>(
    `UPDATE items SET ${setClause} WHERE id = $${nextIndex} RETURNING ${ITEM_COLUMNS}`,
    [...values, id],
  );
  return rows[0] ?? null;
}

/** Deactivate (never hard-delete) so historical reservations keep their FK. */
export async function deactivateItem(
  id: string,
  client?: Queryable,
): Promise<ItemRow | null> {
  const { rows } = await executor(client).query<ItemRow>(
    `UPDATE items SET active = false, updated_at = now() WHERE id = $1
     RETURNING ${ITEM_COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}
