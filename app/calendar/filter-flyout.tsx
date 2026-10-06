"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { CalendarView } from "@/lib/calendar/bars";

import styles from "./page.module.css";

export interface FilterFlyoutItem {
  slug: string;
  name: string;
}

interface FilterFlyoutProps {
  /** Catalog products offered as product-filter checkboxes. */
  items: FilterFlyoutItem[];
  /** Current filter state, to pre-check the form on open. */
  showCancelled: boolean;
  selectedSlugs: string[];
  /** Preserved as hidden fields so Apply doesn't lose the current view. */
  weekIso: string;
  view: CalendarView;
  /** Badge count shown on the trigger — see `countActiveFilters` (bars.ts). */
  activeCount: number;
}

/**
 * Filter panel for `/calendar`: "show cancelled" + filter-by-product. Models
 * its open/close behavior on components/nav/AccountMenu.tsx (aria-expanded,
 * Escape closes + returns focus, outside-click closes).
 *
 * This component makes NO security decisions — it is cosmetic only. Filter
 * state lives entirely in the URL: the panel body is a plain
 * `<form method="GET">` that navigates on Apply, so it works with JS
 * disabled; the only client state here is "is the panel open".
 */
export function FilterFlyout({
  items,
  showCancelled,
  selectedSlugs,
  weekIso,
  view,
  activeCount,
}: FilterFlyoutProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
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

  return (
    <div className={styles.filterRoot}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.navBtn}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        Filters
        {activeCount > 0 && <span className={styles.filterBadge}>{activeCount}</span>}
      </button>

      {open ? (
        <div id={panelId} ref={panelRef} className={styles.filterPanel}>
          <form method="GET" action="/calendar">
            <input type="hidden" name="week" value={weekIso} />
            <input type="hidden" name="view" value={view} />

            <fieldset className={styles.filterSection}>
              <legend>Status</legend>
              <label className={styles.filterCheckbox}>
                <input
                  type="checkbox"
                  name="cancelled"
                  value="1"
                  defaultChecked={showCancelled}
                />
                Show cancelled reservations
              </label>
            </fieldset>

            {items.length > 0 && (
              <fieldset className={styles.filterSection}>
                <legend>Products</legend>
                {items.map((item) => (
                  <label key={item.slug} className={styles.filterCheckbox}>
                    <input
                      type="checkbox"
                      name="items"
                      value={item.slug}
                      defaultChecked={selectedSlugs.includes(item.slug)}
                    />
                    {item.name}
                  </label>
                ))}
              </fieldset>
            )}

            <button type="submit" className={styles.filterApply}>
              Apply
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
