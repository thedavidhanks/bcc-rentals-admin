-- =============================================================================
-- BCC Rentals Admin — new schema (spec §5)
-- =============================================================================
-- Added by the ADMIN app against the SAME Neon Postgres DB as the storefront.
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS) so re-applying is safe alongside the storefront's own schema.
--
-- FK ordering matters. reservation_groups references reservation_series, and the
-- reservations columns reference both, so we create objects in dependency order:
--   1. reservation_series
--   2. reservation_groups        (references reservation_series)
--   3. ALTER reservations        (references reservation_groups + reservation_series)
--   4. admin_audit_log
--   5. app_users
-- =============================================================================

-- 1. Recurrence rule for a repeating booking. Each occurrence materializes as one
--    reservation_group + its reservation rows (see spec §9).
CREATE TABLE IF NOT EXISTS reservation_series (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freq           text NOT NULL CHECK (freq IN ('daily','weekly','monthly','yearly')),
  interval       int  NOT NULL DEFAULT 1 CHECK (interval > 0),   -- "every X" → interval = X
  by_weekday     smallint[],                  -- weekly-on-these-days; 0=Sun..6=Sat; null = anchor's weekday
  starts_on      date NOT NULL,               -- first occurrence date (Eastern)
  until_date     date,                        -- inclusive end; null if using count
  count          int,                         -- max occurrences; null if using until_date
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  check (until_date IS NOT NULL OR count IS NOT NULL)   -- must terminate somehow
);

-- 2. A reservation "booking" groups multiple item reservations that were made
--    together (e.g. Auditorium + 2 rooms + 200 chairs for one Sunday event).
--    One group → many rows in `reservations`.
CREATE TABLE IF NOT EXISTS reservation_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text,                        -- e.g. "Sunday service"
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  notes          text,
  series_id      uuid REFERENCES reservation_series(id) ON DELETE SET NULL,
  occurrence_at  timestamptz,                 -- anchor date of this occurrence (null = one-off)
  created_by     text,                        -- app_users.uid of the scheduler/admin
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 3. Link individual reservation rows to their group and (optionally) series.
--    The storefront ignores these columns.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS group_id  uuid REFERENCES reservation_groups(id) ON DELETE CASCADE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES reservation_series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS reservations_group_idx  ON reservations (group_id);
CREATE INDEX IF NOT EXISTS reservations_series_idx ON reservations (series_id);

-- 4. Audit trail: who changed prices, committed dates, edited products.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid   text NOT NULL,                  -- app_users.uid
  actor_email text,
  action      text NOT NULL,                  -- e.g. 'price.create', 'reservation.create', 'item.update'
  entity      text NOT NULL,                  -- e.g. 'item_prices', 'reservations', 'items'
  entity_id   text,                           -- affected row id/slug
  detail      jsonb,                          -- before/after or payload
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC);

-- 5. Admin/scheduler accounts. Firebase UID is the durable account id; role is the
--    canonical permission store (see spec §3). Email/name are for display only.
--
--    P6.6 (invite-by-email onboarding): `uid` is NULLABLE. A pending invite is a
--    real row with uid=NULL / active=false whose UID is bound on the invitee's
--    first verified sign-in. UID remains the durable, canonical key — email is
--    used ONCE only to match a pending invite, never as the ongoing key (spec §3).
--    Fresh apply produces the correct end state (no NOT NULL, no inline UNIQUE);
--    the ALTER/DROP/CREATE-INDEX below reconcile a branch that already has the old
--    `uid text UNIQUE NOT NULL` shape. Every statement is idempotent + re-runnable.
CREATE TABLE IF NOT EXISTS app_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid        text,                           -- Firebase Authentication UID (NULL = pending invite)
  email      text,                           -- lowercase; for display/contact, not the key
  name       text,
  role       text NOT NULL CHECK (role IN ('scheduler', 'admin')),
  active     boolean NOT NULL DEFAULT true,
  last_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_users_email_idx ON app_users (lower(email));

-- P6.6 reconciliation on an already-applied branch: drop the NOT NULL and the
-- inline column UNIQUE constraint (Postgres auto-names the inline `UNIQUE(uid)`
-- constraint `app_users_uid_key`), then re-express uniqueness as a PARTIAL unique
-- index so multiple pending invites (uid IS NULL) can coexist while bound UIDs
-- stay unique.
ALTER TABLE app_users ALTER COLUMN uid DROP NOT NULL;
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_uid_key;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_uid_key
  ON app_users (uid) WHERE uid IS NOT NULL;

-- At most one OPEN invite (uid IS NULL) per email address, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_pending_email_key
  ON app_users (lower(email)) WHERE uid IS NULL;
