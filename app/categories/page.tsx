import { requireAdmin } from "@/lib/auth/guards";

import { CategoriesManager, type CategoryView, type ItemOptionView } from "./categories-manager";

// Categories admin (execution-plan P6.5, spec §6/§7). ADMIN-ONLY: schedulers and
// unauthenticated users are denied here (server-enforced by requireAdmin — the
// nav also hides this entry, but the server is the real gate). Read per request;
// never prerender, and defer the DB import so `next build` stays free of
// DATABASE_URL / env boot validation (mirrors app/users/page.tsx, P6.6).
export const dynamic = "force-dynamic";

async function loadData(): Promise<{
  categories: CategoryView[];
  items: ItemOptionView[];
}> {
  const { listCategories } = await import("@/lib/repositories/categories");
  const { listItems } = await import("@/lib/repositories/items");
  const { listItemsForCategory } = await import("@/lib/repositories/item-categories");

  const [categoryRows, itemRows] = await Promise.all([listCategories(), listItems()]);

  // One listItemsForCategory query per category (small, admin-managed table —
  // seeded with ~7 rows, spec §4) to build both directions of the membership map
  // without a second per-item round trip.
  const memberships = await Promise.all(
    categoryRows.map(async (c) => ({
      categoryId: c.id,
      itemIds: (await listItemsForCategory(c.id)).map((i) => i.id),
    })),
  );

  const itemCategoryIds = new Map<string, string[]>(itemRows.map((i) => [i.id, []]));
  for (const { categoryId, itemIds } of memberships) {
    for (const itemId of itemIds) {
      itemCategoryIds.get(itemId)?.push(categoryId);
    }
  }

  const categories: CategoryView[] = categoryRows.map((c, idx) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    sortOrder: c.sort_order,
    assignedCount: memberships[idx].itemIds.length,
  }));

  const items: ItemOptionView[] = itemRows.map((i) => ({
    id: i.id,
    name: i.name,
    active: i.active,
    categoryIds: itemCategoryIds.get(i.id) ?? [],
  }));

  return { categories, items };
}

export default async function CategoriesPage() {
  // Admin only; unauthenticated → /login, scheduler → ForbiddenError (spec §3).
  await requireAdmin();

  let categories: CategoryView[] = [];
  let items: ItemOptionView[] = [];
  let loadError: string | null = null;
  try {
    ({ categories, items } = await loadData());
  } catch {
    loadError = "Could not load categories. Check the database connection.";
  }

  return <CategoriesManager categories={categories} items={items} loadError={loadError} />;
}
