import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/guards";
import { isDevBypassEnabled } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

// Login page (spec §3, execution-plan P4.1). Server component: it decides whether
// the dev-bypass role picker or the real Firebase provider buttons render, and
// bounces already-signed-in users to the app.
export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 420 }}>
      <h1>BCC Rentals Admin</h1>
      <p>Sign in to continue.</p>
      <LoginForm devBypass={isDevBypassEnabled()} />
    </main>
  );
}
