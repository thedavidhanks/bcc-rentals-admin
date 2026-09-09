// Plain (non-server, non-client) module shared by app/reservations/new/actions.ts
// and app/reservations/new/reservation-form.tsx.
//
// Why this file exists (execution-plan P11.10, spec §7): a rejected submission
// (validation failure or an all-or-nothing capacity conflict — routine on a
// busy calendar) must not wipe the form. The echo has to survive a *failed*
// Zod parse, so it is captured as raw strings independently of validation,
// before the schema ever runs. vitest does not collect .tsx (vitest.config.ts
// `include: ["tests/**/*.test.ts"]`), so this pure logic lives in its own
// plain .ts module to stay unit-testable — no "use server", no "server-only",
// no DB import, safe to import from the client component too.
//
// readSubmittedValues() replaces the old readForm() in actions.ts: same
// index-scanning logic for line items (`line-<i>-<field>`, non-contiguous
// indices tolerated), but it returns raw strings instead of feeding straight
// into Zod, so the shape below is also exactly what the form re-seeds itself
// from on a failed submit.

export interface SubmittedLine {
  itemSlug: string;
  quantity: string;
}

export interface SubmittedRecurrence {
  freq: string;
  interval: string;
  byWeekday: string[];
  endMode: string;
  untilDate: string;
  count: string;
}

export interface SubmittedValues {
  /** Shared "When" box (P11.9) — Eastern civil date + HH:MM, applied to every line. */
  date: string;
  startMinute: string;
  endMinute: string;
  title: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  recurring: boolean;
  recurrence: SubmittedRecurrence;
  lines: SubmittedLine[];
}

export const EMPTY_SUBMITTED_VALUES: SubmittedValues = {
  date: "",
  startMinute: "",
  endMinute: "",
  title: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  notes: "",
  recurring: false,
  recurrence: {
    freq: "weekly",
    interval: "1",
    byWeekday: [],
    endMode: "count",
    untilDate: "",
    count: "4",
  },
  lines: [{ itemSlug: "", quantity: "1" }],
};

/**
 * Read the flat FormData the client form submits into raw strings, mirroring
 * the field names in reservation-form.tsx exactly. No validation, no
 * transforms other than "field absent → empty string" — this must succeed
 * (and echo faithfully) even when the submission is garbage.
 */
export function readSubmittedValues(formData: FormData): SubmittedValues {
  const str = (k: string): string => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };

  // Collect line indices present in the payload (non-contiguous tolerated).
  const lineIndices = new Set<number>();
  for (const key of formData.keys()) {
    const m = /^line-(\d+)-/.exec(key);
    if (m) lineIndices.add(Number(m[1]));
  }
  const lines: SubmittedLine[] = [...lineIndices]
    .sort((a, b) => a - b)
    .map((i) => ({
      itemSlug: str(`line-${i}-itemSlug`),
      quantity: str(`line-${i}-quantity`) || "1",
    }));

  const recurring =
    formData.get("recurring") === "on" || formData.get("recurring") === "true";

  const recurrence: SubmittedRecurrence = {
    freq: str("recurrence-freq") || "weekly",
    interval: str("recurrence-interval") || "1",
    byWeekday: formData.getAll("recurrence-byWeekday").map((v) => String(v)),
    endMode: str("recurrence-endMode") || "count",
    untilDate: str("recurrence-untilDate"),
    count: str("recurrence-count") || "4",
  };

  return {
    date: str("date"),
    startMinute: str("startMinute"),
    endMinute: str("endMinute"),
    title: str("title"),
    contactName: str("contactName"),
    contactEmail: str("contactEmail"),
    contactPhone: str("contactPhone"),
    notes: str("notes"),
    recurring,
    recurrence,
    lines,
  };
}
