import { describe, expect, it } from "vitest";

import {
  ACCOUNT_MENU_ITEMS,
  getInitials,
} from "@/components/nav/account-menu";

// Pure-helper tests for the P11.2 account menu (components/nav/account-menu.ts).
// vitest.config.ts only collects tests/**/*.test.ts and there is no jsdom /
// testing-library installed, so the DOM-facing AccountMenu.tsx / AppNav.tsx
// are not unit-tested here — this covers the extracted, DOM-free logic.

describe("getInitials", () => {
  it("derives two initials from an email with no separator (dhanks@bachmancc.org)", () => {
    expect(getInitials({ email: "dhanks@bachmancc.org" })).toBe("DH");
  });

  it("derives initials from an email local-part split on '.'", () => {
    expect(getInitials({ email: "jane.doe@example.com" })).toBe("JD");
  });

  it("derives initials from an email local-part split on '_', '-', or '+'", () => {
    expect(getInitials({ email: "jane_doe@example.com" })).toBe("JD");
    expect(getInitials({ email: "jane-doe@example.com" })).toBe("JD");
    expect(getInitials({ email: "jane+doe@example.com" })).toBe("JD");
  });

  it("handles an email with no '@' by using the whole string", () => {
    expect(getInitials({ email: "dhanks" })).toBe("DH");
  });

  it("returns the fallback for an empty email string", () => {
    expect(getInitials({ email: "" })).toBe("?");
  });

  it("returns the fallback for a whitespace-only email", () => {
    expect(getInitials({ email: "   " })).toBe("?");
  });

  it("returns the fallback when both name and email are null", () => {
    expect(getInitials({ name: null, email: null })).toBe("?");
  });

  it("returns the fallback when both name and email are undefined", () => {
    expect(getInitials({})).toBe("?");
  });

  it("prefers name over email when both are present", () => {
    expect(getInitials({ name: "David Hanks", email: "dhanks@bachmancc.org" })).toBe(
      "DH"
    );
    // Different initials from name vs. email proves name won, not email.
    expect(getInitials({ name: "Maria Fernandez", email: "dhanks@bachmancc.org" })).toBe(
      "MF"
    );
  });

  it("falls back to email when name is null/empty/whitespace-only", () => {
    expect(getInitials({ name: null, email: "dhanks@bachmancc.org" })).toBe("DH");
    expect(getInitials({ name: "", email: "dhanks@bachmancc.org" })).toBe("DH");
    expect(getInitials({ name: "   ", email: "dhanks@bachmancc.org" })).toBe("DH");
  });

  it("derives two initials (first + last word) from a multi-word name", () => {
    expect(getInitials({ name: "David Hanks" })).toBe("DH");
    expect(getInitials({ name: "Maria de la Cruz Fernandez" })).toBe("MF");
  });

  it("derives two initials from a single-word name", () => {
    expect(getInitials({ name: "Madonna" })).toBe("MA");
  });

  it("handles a very long single-word name by taking just the first two characters", () => {
    const longName = "Supercalifragilisticexpialidocious";
    expect(getInitials({ name: longName })).toBe("SU");
  });

  it("handles a very long email local-part with no separators", () => {
    expect(
      getInitials({ email: "supercalifragilisticexpialidocious@example.com" })
    ).toBe("SU");
  });

  it("is Unicode-safe (does not split a multi-byte character in half)", () => {
    expect(getInitials({ name: "Jürgen Müller" })).toBe("JM");
    expect(getInitials({ email: "jürgen@example.com" })).toBe("JÜ");
  });

  it("always returns an uppercase result", () => {
    expect(getInitials({ name: "david hanks" })).toBe("DH");
    expect(getInitials({ email: "dhanks@bachmancc.org" })).toBe("DH");
  });

  // Malformed/degenerate emails shouldn't occur in practice (Firebase auth
  // requires a non-empty local part), but getInitials is a general-purpose
  // exported helper, so pin down what it actually does with them rather than
  // leaving the behavior unspecified.
  it("documents current behavior for a local-part made only of separators", () => {
    // "..." between "@" and the domain has no alphanumeric parts once split
    // on [._+-]+, so it falls back to the first two raw characters.
    expect(getInitials({ email: "...@example.com" })).toBe("..");
  });

  it("documents current behavior for an email with an empty local part", () => {
    // Splitting "@example.com" on "@" yields local === "", so `base` falls
    // back to the *whole* trimmed string (including the leading "@"), which
    // then splits into two "parts" around the domain's ".": ["@example",
    // "com"]. The first initial ends up being the literal "@" character,
    // not a letter — a known quirk for this degenerate input, not something
    // a valid email address can produce.
    expect(getInitials({ email: "@example.com" })).toBe("@C");
  });
});

describe("ACCOUNT_MENU_ITEMS", () => {
  it("contains exactly Update profile and Logout, in that order", () => {
    expect(ACCOUNT_MENU_ITEMS.map((item) => item.label)).toEqual([
      "Update profile",
      "Logout",
    ]);
  });

  it("routes 'Update profile' to /profile as a link item", () => {
    const item = ACCOUNT_MENU_ITEMS.find((i) => i.label === "Update profile");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("link");
    if (item?.kind === "link") {
      expect(item.href).toBe("/profile");
    }
  });

  it("wires 'Logout' as a signout action item, not a link", () => {
    const item = ACCOUNT_MENU_ITEMS.find((i) => i.label === "Logout");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("action");
    if (item?.kind === "action") {
      expect(item.action).toBe("signout");
    }
  });
});
