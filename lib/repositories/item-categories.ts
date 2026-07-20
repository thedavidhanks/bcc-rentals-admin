import "server-only";

import { executor, type Queryable } from "./shared";
import type { CategoryRow, ItemRow } from "./types";

// Repository for the shared `item_categories` join (spec §4). Many-to-many
// between items and categories; composite PK (item_id, category_id).
//
// TODO(P9): consolidate — mirrors the storefront's item↔category join shape.

/** Categories a given item belongs to, in category display order. */
export async function listCategoriesForItem(
  itemId: string,
  client?: Queryable,
): Promise<CategoryRow[]> {
  const { rows } = await executor(client).query<CategoryRow>(
    `SELECT c.id, c.slug, c.name, c.sort_order, c.created_at
       FROM categories c
       JOIN item_categories ic ON ic.category_id = c.id
      WHERE ic.item_id = $1
      ORDER BY c.sort_order ASC, c.name ASC`,
    [itemId],
  );
  return rows;
}

/** Items assigned to a given category, in item display order. */
export async function listItemsForCategory(
  categoryId: string,
  client?: Queryable,
): Promise<ItemRow[]> {
  const { rows } = await executor(client).query<ItemRow>(
    `SELECT i.*
       FROM items i
       JOIN item_categories ic ON ic.item_id = i.id
      WHERE ic.category_id = $1
      ORDER BY i.sort_order ASC, i.name ASC`,
    [categoryId],
  );
  return rows;
}

/** Assign an item to a category. Idempotent (ON CONFLICT DO NOTHING). */
export async function assignItemToCategory(
  itemId: string,
  categoryId: string,
  client?: Queryable,
): Promise<void> {
  await executor(client).query(
    `INSERT INTO item_categories (item_id, category_id) VALUES ($1, $2)
     ON CONFLICT (item_id, category_id) DO NOTHING`,
    [itemId, categoryId],
  );
}

export async function removeItemFromCategory(
  itemId: string,
  categoryId: string,
  client?: Queryable,
): Promise<boolean> {
  const { rowCount } = await executor(client).query(
    `DELETE FROM item_categories WHERE item_id = $1 AND category_id = $2`,
    [itemId, categoryId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Replace the full set of categories for an item. Runs two statements; pass a
 * transaction `client` so the delete+insert are atomic.
 */
export async function setItemCategories(
  itemId: string,
  categoryIds: string[],
  client?: Queryable,
): Promise<void> {
  const exec = executor(client);
  await exec.query(`DELETE FROM item_categories WHERE item_id = $1`, [itemId]);
  if (categoryIds.length === 0) return;
  // Expand into one multi-row insert: ($1,$2),($1,$3),...
  const valuesSql = categoryIds
    .map((_, idx) => `($1, $${idx + 2})`)
    .join(", ");
  await exec.query(
    `INSERT INTO item_categories (item_id, category_id) VALUES ${valuesSql}
     ON CONFLICT (item_id, category_id) DO NOTHING`,
    [itemId, ...categoryIds],
  );
}
