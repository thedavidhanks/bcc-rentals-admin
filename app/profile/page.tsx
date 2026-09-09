import { requireScheduler } from "@/lib/auth/guards";
import type { SessionUser } from "@/lib/auth/types";
import type { AppUserRow } from "@/lib/repositories/types";

import { ProfileManager, type ProfileView } from "./profile-manager";

// Self-service profile page (execution-plan P11.3, spec §3/§7). Both roles may
// use this page — requireScheduler() already admits admin (see
// lib/auth/guards.ts) — do NOT invent a new guard. The row is read per
// request; never prerender it, and defer the DB import so `next build` stays
// free of DATABASE_URL / env boot validation (mirrors app/users/page.tsx).
export const dynamic = "force-dynamic";

const LAST_LOGIN_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
});

const ROLE_LABELS: Record<AppUserRow["role"], string> = {
  scheduler: "Scheduler",
  admin: "Admin",
};

async function loadRow(uid: string): Promise<AppUserRow | null> {
  const { getUserByUid } = await import("@/lib/repositories/app-users");
  return getUserByUid(uid);
}

/**
 * Build the display view from a loaded row, or — when no row exists (a
 * dev-bypass session, spec §3: this app never auto-provisions) — from the
 * session alone, with editing disabled (`hasRow: false`).
 */
function viewFrom(row: AppUserRow | null, user: SessionUser): ProfileView {
  if (row) {
    return {
      hasRow: true,
      name: row.name,
      email: row.email ?? user.email,
      roleLabel: ROLE_LABELS[row.role],
      lastLogin: row.last_login ? LAST_LOGIN_FMT.format(row.last_login) : null,
    };
  }
  return {
    hasRow: false,
    name: null,
    email: user.email,
    roleLabel: ROLE_LABELS[user.role],
    lastLogin: null,
  };
}

export default async function ProfilePage() {
  // Both schedulers and admins may view/edit their own profile.
  const user = await requireScheduler();

  let profile: ProfileView;
  let loadError: string | null = null;
  try {
    profile = viewFrom(await loadRow(user.uid), user);
  } catch {
    loadError = "Could not load your profile. Check the database connection.";
    profile = viewFrom(null, user);
  }

  return <ProfileManager profile={profile} loadError={loadError} />;
}
