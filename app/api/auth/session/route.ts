import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { createSession, isDevBypassEnabled } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/types";

// Session login/logout endpoint (spec §3, execution-plan P4.2).
//   POST   — exchange a login credential for an httpOnly session cookie.
//            Real path: { idToken }. Dev-bypass: { role, uid?, email? }.
//   DELETE — sign out (clear the cookie).
//
// Node runtime: createSession() may call the Firebase Admin SDK (once Q2 lands),
// which cannot run on the Edge runtime.
export const runtime = "nodejs";

function isRole(value: unknown): value is UserRole {
  return value === "scheduler" || value === "admin";
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const idToken = typeof body.idToken === "string" ? body.idToken : undefined;
  const uid = typeof body.uid === "string" ? body.uid : undefined;
  const email = typeof body.email === "string" ? body.email : undefined;
  const devRole =
    isDevBypassEnabled() && isRole(body.role) ? body.role : undefined;

  try {
    const session = await createSession({ idToken, devRole, uid, email });
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, session.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: session.maxAgeSeconds,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in failed";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
