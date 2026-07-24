import { SignOutButton } from "@/components/sign-out-button";
import { requireScheduler } from "@/lib/auth/guards";

// Home page — gated by requireScheduler(): unauthenticated callers are redirected
// to /login (also enforced by middleware). Placeholder content; the responsive
// app shell + calendar land in P5 (Agent B) and reuse getSessionUser() to hide
// admin-only nav.
export default async function Home() {
  const user = await requireScheduler();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>BCC Rentals Admin</h1>
      <p>
        Signed in as <strong>{user.email ?? user.uid}</strong> ({user.role}).
      </p>
      <p>
        Authenticated calendar, reservations, catalog, and user management arrive
        in later phases.
      </p>
      <SignOutButton />
    </main>
  );
}
