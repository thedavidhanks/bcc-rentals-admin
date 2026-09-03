"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/components/sign-out-button";
import { ACCOUNT_MENU_ITEMS, getInitials, type MonogramIdentity } from "./account-menu";

interface AccountMenuProps {
  /** Identity used to derive the avatar monogram and the trigger's aria-label. */
  identity: MonogramIdentity;
}

/**
 * Circular avatar button + dropdown menu, rendered in the top-right of the
 * app nav (spec §7 menu bar; P11.2). Contains "Update profile" (P11.3 — the
 * route doesn't exist yet, shipping the link anyway per the work order) and
 * "Logout" (reuses the DELETE /api/auth/session flow from sign-out-button.tsx
 * so the fetch only lives in one place).
 *
 * This component makes no security decisions — it is cosmetic only. The
 * server guards (`requireScheduler`/`requireAdmin`) remain the real boundary.
 */
export function AccountMenu({ identity }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  const initials = getInitials(identity);
  const accountLabel = identity.name || identity.email || "your account";

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    // Focus moves into the menu on open (first item).
    itemRefs.current[0]?.focus();

    function focusableItems(): HTMLElement[] {
      return itemRefs.current.filter((el): el is HTMLElement => el !== null);
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      // Outside click closes the menu.
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      const items = focusableItems();
      if (items.length === 0) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = items[(currentIndex + 1 + items.length) % items.length];
        next.focus();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = items[(currentIndex - 1 + items.length) % items.length];
        prev.focus();
        return;
      }

      if (event.key === "Tab") {
        // Focus stays trapped in the menu while it is open.
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
  }

  return (
    <div className="app-nav__account">
      <button
        ref={triggerRef}
        type="button"
        className="app-nav__avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${accountLabel}`}
        onClick={() => setOpen((v) => !v)}
      >
        {initials}
      </button>

      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="app-nav__account-menu"
        >
          {ACCOUNT_MENU_ITEMS.map((item, index) =>
            item.kind === "link" ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                className="app-nav__account-menu-item"
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                onClick={close}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="app-nav__account-menu-item"
                disabled={signingOut}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                onClick={handleSignOut}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
