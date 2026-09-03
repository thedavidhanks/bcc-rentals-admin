import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/nav/nav-config";

// ---------------------------------------------------------------------------
// P11.1 regression guard: keep `NAV_ITEMS[*].adminOnly` in sync with the guard
// the destination page actually calls (`requireAdmin` vs `requireScheduler`).
// The bug this catches: a scheduler could click "Products" in the nav (shown
// because `adminOnly` was missing/false) and get a hard `ForbiddenError` from
// `app/products/page.tsx`, because that page calls `requireAdmin()`.
//
// Approach: a STATIC FILE SCAN, not an explicit `ROUTE_GUARDS` map. Each
// `NAV_ITEMS[*].href` is resolved to its `app/**/page.tsx` source (all current
// nav hrefs are static routes, no dynamic segments, so this resolution is
// exact) and the source text is scanned for the guard call. This is preferred
// over a hand-maintained map because a hand-maintained map can drift from the
// page just as easily as `nav-config.ts` itself did — the map would need to be
// kept in sync by a human remembering to update it, which is exactly the
// failure mode we're closing. Scanning the real page source means the guard
// call itself is the single source of truth; there's nothing else to forget
// to update.
//
// The guard call is matched as `await requireAdmin(` / `await requireScheduler(`
// — the stable shape every guarded page uses today (see `app/products/page.tsx`,
// `app/categories/page.tsx`, `app/users/page.tsx`, `app/calendar/page.tsx`,
// `app/prices/page.tsx`, `app/reservations/new/page.tsx`). Matching the call
// form (not a bare `requireAdmin`/`requireScheduler` substring) avoids false
// positives from the prose comments in these files that merely *mention* the
// guard name (e.g. "server-enforced by requireAdmin" with no parens).
// ---------------------------------------------------------------------------

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

const REQUIRE_ADMIN_CALL = /\bawait\s+requireAdmin\s*\(/;
const REQUIRE_SCHEDULER_CALL = /\bawait\s+requireScheduler\s*\(/;

/**
 * Resolve a NAV_ITEMS href to the `app/**\/page.tsx` file that App Router
 * serves for it. All current nav hrefs are static (no `[param]` segments), so
 * a direct segment-to-directory mapping is exact.
 */
function pageFileForHref(href: string): string {
  const segments = href.split("/").filter(Boolean);
  return join(APP_DIR, ...segments, "page.tsx");
}

function guardCallsIn(source: string): {
  callsRequireAdmin: boolean;
  callsRequireScheduler: boolean;
} {
  return {
    callsRequireAdmin: REQUIRE_ADMIN_CALL.test(source),
    callsRequireScheduler: REQUIRE_SCHEDULER_CALL.test(source),
  };
}

describe("nav/guard parity (NAV_ITEMS vs app/**/page.tsx guards)", () => {
  it("every NAV_ITEMS entry resolves to a real page.tsx", () => {
    for (const item of NAV_ITEMS) {
      const file = pageFileForHref(item.href);
      expect(
        existsSync(file),
        `NAV_ITEMS entry "${item.label}" (${item.href}) does not resolve to ` +
          `an existing page at ${file}. If the route moved, update the href ` +
          `in components/nav/nav-config.ts; if the route was removed, remove ` +
          `the nav entry.`,
      ).toBe(true);
    }
  });

  it("adminOnly is true iff the destination page calls requireAdmin()", () => {
    for (const item of NAV_ITEMS) {
      const file = pageFileForHref(item.href);
      const source = readFileSync(file, "utf8");
      const { callsRequireAdmin, callsRequireScheduler } = guardCallsIn(source);

      // Every guarded page must call exactly one of the two guards.
      expect(
        callsRequireAdmin || callsRequireScheduler,
        `NAV_ITEMS entry "${item.label}" (${item.href}) points at ${file}, ` +
          `which calls neither "await requireAdmin()" nor ` +
          `"await requireScheduler()". Every page reachable from the nav must ` +
          `be server-guarded — add the appropriate guard to the page.`,
      ).toBe(true);
      expect(
        callsRequireAdmin && callsRequireScheduler,
        `NAV_ITEMS entry "${item.label}" (${item.href}) points at ${file}, ` +
          `which calls BOTH "await requireAdmin()" and ` +
          `"await requireScheduler()". A page should call exactly one guard ` +
          `(requireAdmin is already scheduler-or-admin-exclusive at the role ` +
          `level, so mixing both is a bug, not defense-in-depth).`,
      ).toBe(false);

      const adminOnly = item.adminOnly === true;
      expect(
        adminOnly,
        `NAV_ITEMS entry "${item.label}" (${item.href}) has adminOnly=${adminOnly}, ` +
          `but ${file} calls ${callsRequireAdmin ? "requireAdmin()" : "requireScheduler()"}. ` +
          `A scheduler clicking this nav entry would ${
            callsRequireAdmin && !adminOnly
              ? "hit a ForbiddenError (the P11.1 bug)"
              : "be needlessly hidden from a page they can access"
          }. Set NAV_ITEMS[...].adminOnly = ${callsRequireAdmin} in ` +
          `components/nav/nav-config.ts to match the page's guard.`,
      ).toBe(callsRequireAdmin);
    }
  });
});
