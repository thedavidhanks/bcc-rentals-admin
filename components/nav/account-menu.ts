// Pure, DOM-free logic for the account menu (P11.2). Kept separate from
// AccountMenu.tsx so it can be unit tested directly under vitest's
// `environment: "node"` (see vitest.config.ts — .tsx files are not collected
// and there is no jsdom / testing-library installed here).

/**
 * Identity fields the initials/monogram derivation can use. `SessionUser`
 * (lib/auth/types.ts) has no `name` today — only `email`. This helper already
 * accepts an optional `name` and prefers it over `email`, so P11.3 (which
 * threads `app_users.name` through) is a one-line change at the call site,
 * not a signature change here.
 */
export interface MonogramIdentity {
  name?: string | null;
  email?: string | null;
}

/** Fallback initial shown when no usable name/email is available. */
const FALLBACK_INITIALS = "?";

/** First Unicode grapheme-ish unit (code point) of a string, or "" if empty. */
function firstCodePoint(value: string): string {
  const chars = Array.from(value);
  return chars.length > 0 ? chars[0] : "";
}

/** First `count` Unicode code points of a string, joined back together. */
function firstCodePoints(value: string, count: number): string {
  return Array.from(value).slice(0, count).join("");
}

/**
 * Derive up to two initials from a display name: first letter of the first
 * word + first letter of the last word (if there are at least two words), or
 * the first two characters of a single word. Returns "" if `name` has no
 * usable content (empty, whitespace-only, null, undefined).
 */
function initialsFromName(name: string | null | undefined): string {
  if (!name) return "";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return firstCodePoints(words[0], 2);
  return firstCodePoint(words[0]) + firstCodePoint(words[words.length - 1]);
}

/**
 * Derive up to two initials from an email address's local part (before the
 * `@`, or the whole string if there is no `@`). Splits on common
 * name-separator punctuation (`.`, `_`, `-`, `+`) to catch `jane.doe@...` ->
 * "JD"; otherwise falls back to the first two characters, e.g.
 * `dhanks@bachmancc.org` -> "DH". Returns "" if `email` has no usable content.
 */
function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const trimmed = email.trim();
  if (!trimmed) return "";
  const [local] = trimmed.split("@");
  const base = local && local.length > 0 ? local : trimmed;
  const parts = base.split(/[._+-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return firstCodePoint(parts[0]) + firstCodePoint(parts[1]);
  }
  return firstCodePoints(base, 2);
}

/**
 * Derive an uppercase, 1-2 character monogram for the account avatar.
 * Prefers `name` (P11.3 will thread `app_users.name` through), falls back to
 * `email`, and falls back to "?" if neither yields anything usable.
 */
export function getInitials({ name, email }: MonogramIdentity): string {
  const fromName = initialsFromName(name);
  if (fromName) return fromName.toUpperCase();
  const fromEmail = initialsFromEmail(email);
  if (fromEmail) return fromEmail.toUpperCase();
  return FALLBACK_INITIALS;
}

/** A navigable entry in the account menu (renders as a `<Link>`). */
export interface AccountMenuLinkItem {
  kind: "link";
  label: string;
  href: string;
}

/** An action entry in the account menu (renders as a `<button>`). */
export interface AccountMenuActionItem {
  kind: "action";
  label: string;
  action: "signout";
}

export type AccountMenuItem = AccountMenuLinkItem | AccountMenuActionItem;

/**
 * The account dropdown's entries, in display order. `/profile` (P11.3) does
 * not exist yet — shipping the link anyway is a smaller defect than a
 * one-item menu; see the P11.2 work order §4.
 */
export const ACCOUNT_MENU_ITEMS: readonly AccountMenuItem[] = [
  { kind: "link", label: "Update profile", href: "/profile" },
  { kind: "action", label: "Logout", action: "signout" },
];
