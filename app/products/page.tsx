import { requireAdmin } from "@/lib/auth/guards";

import { ProductsList, type ProductRowView } from "./products-list";

// Products admin (execution-plan P6.4, spec §6/§7). ADMIN-ONLY: schedulers and
// unauthenticated users are denied here (server-enforced by requireAdmin — the
// nav also hides this, but the server is the real gate). The list is read per
// request; never prerender it, and defer the DB import so `next build` stays
// free of DATABASE_URL / env boot validation (mirrors app/users/page.tsx).
export const dynamic = "force-dynamic";

async function loadProducts(): Promise<ProductRowView[]> {
  const { listItems } = await import("@/lib/repositories/items");
  const rows = await listItems(); // active + inactive
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type,
    totalStock: r.total_stock,
    active: r.active,
    pricingUnit: r.pricing_unit,
    sortOrder: r.sort_order,
  }));
}

export default async function ProductsPage() {
  // Admin only; unauthenticated → /login, scheduler → ForbiddenError (spec §3).
  await requireAdmin();

  let products: ProductRowView[] = [];
  let loadError: string | null = null;
  try {
    products = await loadProducts();
  } catch {
    loadError = "Could not load products. Check the database connection.";
  }

  return <ProductsList products={products} loadError={loadError} />;
}
