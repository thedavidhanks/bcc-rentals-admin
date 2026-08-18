import { requireAdmin } from "@/lib/auth/guards";

import { UsersManager, type UserRowView } from "./users-manager";

// User & role management (execution-plan P6.6, spec §6/§7). ADMIN-ONLY: schedulers
// and unauthenticated users are denied here (server-enforced by requireAdmin —
// the nav also hides this, but the server is the real gate). The list is read per
// request; never prerender it, and defer the DB import so `next build` stays free
// of DATABASE_URL / env boot validation (mirrors app/reservations/new/page.tsx).
export const dynamic = "force-dynamic";

const LAST_LOGIN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
});

async function loadUsers(): Promise<UserRowView[]> {
  const { listUsers } = await import("@/lib/repositories/app-users");
  const rows = await listUsers(); // all users: active + inactive + pending invites
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid,
    email: r.email,
    name: r.name,
    role: r.role,
    active: r.active,
    lastLogin: r.last_login ? LAST_LOGIN_FMT.format(r.last_login) : null,
  }));
}

export default async function UsersPage() {
  // Admin only; unauthenticated → /login, scheduler → ForbiddenError (spec §3).
  await requireAdmin();

  let users: UserRowView[] = [];
  let loadError: string | null = null;
  try {
    users = await loadUsers();
  } catch {
    loadError = "Could not load users. Check the database connection.";
  }

  return <UsersManager users={users} loadError={loadError} />;
}
