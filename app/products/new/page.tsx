import { requireAdmin } from "@/lib/auth/guards";

import { ProductForm } from "../product-form";

// Add Product page (execution-plan P6.4, spec §6/§7). Admin-only. Rendering
// the empty form needs no DB read, so there is nothing to defer here — the
// mutation itself goes through createProductAction (app/products/actions.ts),
// which is "use server" + "server-only" already.
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  // Admin only; unauthenticated → /login, scheduler → ForbiddenError (spec §3).
  await requireAdmin();

  return <ProductForm mode="create" />;
}
