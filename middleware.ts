import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

// Edge-runtime gate (spec §3, execution-plan P4.2).
//
// Middleware runs in the Edge runtime, where the Firebase Admin SDK and `pg`
// cannot load, so it does a LIGHTWEIGHT check only: is a session cookie present?
// If not, redirect page requests to /login. Full cryptographic verification of
// the cookie and the UID → app_users → role authorization happen in the
// Node-runtime guards (lib/auth/guards.ts), which every Server Component, route
// handler, and server action calls. Never rely on this middleware alone for
// authorization — it is a first-pass redirect, not the security boundary.

const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  const hasSession = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Guard pages only. `/api/*` routes enforce access in-handler via the guards
  // (and /api/auth/session must stay reachable to set the cookie). Skip Next
  // internals and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
