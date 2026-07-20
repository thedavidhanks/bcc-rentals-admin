import "server-only";

import { buildSet, executor, type Queryable } from "./shared";
import type { CategoryInsert, CategoryRow, CategoryUpdate } from "./types";

// Repository for the shared `categories` table (spec §4). Admin-managed browse
// categories (unique slug, name, sort_order).
//
// TODO(P9): consolidate — mirrors the storefront's category row shape.

const CATEGORY_COLUMNS = `id, slug, name, sort_order, created_at`;

const CATEGORY_UPDATE_COLUMNS = ["slug", "name", "sort_order"] as const;

export async function listCategories(
  client?: Queryable,
): Promise<CategoryRow[]> {
  const { rows } = await executor(client).query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories ORDER BY sort_order ASC, name ASC`,
  );
  return rows;
}

export async function getCategoryById(
  id: string,
  client?: Queryable,
): Promise<CategoryRow | null> {
  const { rows } = await executor(client).query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getCategoryBySlug(
  slug: string,
  client?: Queryable,
): Promise<CategoryRow | null> {
  const { rows } = await executor(client).query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function createCategory(
  input: CategoryInsert,
  client?: Queryable,
): Promise<CategoryRow> {
  const { rows } = await executor(client).query<CategoryRow>(
    `INSERT INTO categories (slug, name, sort_order, created_at)
     VALUES ($1, $2, COALESCE($3, 0), now())
     RETURNING ${CATEGORY_COLUMNS}`,
    [input.slug, input.name, input.sort_order ?? null],
  );
  return rows[0];
}

export async function updateCategory(
  id: string,
  patch: CategoryUpdate,
  client?: Queryable,
): Promise<CategoryRow | null> {
  const { clause, values, nextIndex } = buildSet(
    patch as Record<string, unknown>,
    CATEGORY_UPDATE_COLUMNS,
  );
  if (!clause) return getCategoryById(id, client);
  const { rows } = await executor(client).query<CategoryRow>(
    `UPDATE categories SET ${clause} WHERE id = $${nextIndex}
     RETURNING ${CATEGORY_COLUMNS}`,
    [...values, id],
  );
  return rows[0] ?? null;
}

export async function deleteCategory(
  id: string,
  client?: Queryable,
): Promise<boolean> {
  const { rowCount } = await executor(client).query(
    `DELETE FROM categories WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}
