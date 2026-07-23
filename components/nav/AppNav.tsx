"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavItem } from "./nav-config";

interface AppNavProps {
  /** Menu entries already filtered for the current role (server-side). */
  items: NavItem[];
  /** Display name / email of the signed-in user, if any. */
  userLabel?: string | null;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Responsive top menu bar. On wide screens the links sit inline; below the
 * breakpoint they collapse behind a hamburger toggle (spec §7). This component
 * makes NO security decisions — it only renders the entries it is handed.
 */
export function AppNav({ items, userLabel }: AppNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="app-nav">
      <div className="app-nav__bar">
        <Link href="/calendar" className="app-nav__brand" onClick={() => setOpen(false)}>
          BCC Rentals Admin
        </Link>

        <button
          type="button"
          className="app-nav__toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={open}
          aria-controls="app-nav-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="app-nav__toggle-bar" aria-hidden="true" />
          <span className="app-nav__toggle-bar" aria-hidden="true" />
          <span className="app-nav__toggle-bar" aria-hidden="true" />
        </button>

        <nav
          id="app-nav-menu"
          className={`app-nav__menu${open ? " app-nav__menu--open" : ""}`}
          aria-label="Primary"
        >
          <ul className="app-nav__list">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`app-nav__link${
                    isActive(pathname, item.href) ? " app-nav__link--active" : ""
                  }`}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          {userLabel ? <span className="app-nav__user">{userLabel}</span> : null}
        </nav>
      </div>
    </header>
  );
}
