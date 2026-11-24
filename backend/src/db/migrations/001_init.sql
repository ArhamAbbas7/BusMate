-- EV Bus Tracking - initial schema (SRS section 7)

CREATE TABLE operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  package       TEXT NOT NULL DEFAULT 'basic' CHECK (package IN ('basic','premium','gold')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  contact_email TEXT,
  contact_phone TEXT,
  passenger_price INTEGER NOT NULL DEFAULT 350,
  -- {"jazzcash":{"account":"0300...","title":"..."},"easypaisa":{...},"bank":{"bank":"..","account":"..","title":".."}}
  payment_instructions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('developer','admin')),
  operator_id   UUID REFERENCES operators(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  totp_secret   TEXT,
  totp_enabled  BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 7.3: admin must have operator_id
  CONSTRAINT admin_has_operator CHECK (role = 'developer' OR operator_id IS NOT NULL)
);

CREATE TABLE conductors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  last_login_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE routes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  towards_label  TEXT NOT NULL DEFAULT 'Towards',
  backward_label TEXT NOT NULL DEFAULT 'Backward',
  path           JSONB NOT NULL DEFAULT '[]'::jsonb, -- [[lat,lng],...] in the "towards" direction
  live_token     TEXT NOT NULL UNIQUE,                -- public map link token
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, code)
);
CREATE INDEX idx_routes_operator ON routes(operator_id, status);

-- SR-05: exactly 4 groups per route (2 cohorts x 2 directions)
CREATE TABLE route_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id    UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  cohort      CHAR(1) NOT NULL CHECK (cohort IN ('A','B')),
  direction   TEXT NOT NULL CHECK (direction IN ('towards','backward')),
  wa_group_id TEXT NOT NULL DEFAULT '',
  invite_link TEXT NOT NULL DEFAULT '',
  UNIQUE (route_id, cohort, direction)
);

-- One row per cohort instance (e.g. A starting 2026-12-01)
CREATE TABLE cohorts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         CHAR(1) NOT NULL CHECK (code IN ('A','B')),
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  signup_start DATE NOT NULL,
  signup_end   DATE NOT NULL,
  UNIQUE (code, start_date)
);

CREATE TABLE conductor_route_assignments (
  conductor_id UUID NOT NULL REFERENCES conductors(id) ON DELETE CASCADE,
  route_id     UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conductor_id, route_id)
);

CREATE TABLE trip_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  conductor_id UUID NOT NULL REFERENCES conductors(id) ON DELETE CASCADE,
  route_id     UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL CHECK (direction IN ('towards','backward')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','auto_closed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  last_ping_at TIMESTAMPTZ,
  last_lat     DOUBLE PRECISION,
  last_lng     DOUBLE PRECISION,
  ping_count   INTEGER NOT NULL DEFAULT 0,
  end_reason   TEXT
);
CREATE INDEX idx_trip_active ON trip_sessions(status) WHERE status = 'active';
CREATE INDEX idx_trip_operator ON trip_sessions(operator_id, started_at DESC);
-- SR-01 / FR-C-13: one active trip per conductor
CREATE UNIQUE INDEX uq_trip_active_conductor ON trip_sessions(conductor_id) WHERE status = 'active';
-- SR-02: one active trip per route + direction
CREATE UNIQUE INDEX uq_trip_active_route_dir ON trip_sessions(route_id, direction) WHERE status = 'active';

CREATE TABLE location_pings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_session_id UUID NOT NULL REFERENCES trip_sessions(id) ON DELETE CASCADE,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  accuracy        DOUBLE PRECISION,
  speed           DOUBLE PRECISION,
  heading         DOUBLE PRECISION,
  recorded_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pings_session ON location_pings(trip_session_id, recorded_at DESC);

CREATE TABLE subscribers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  subscriber_id       UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  route_id            UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  cohort_id           UUID NOT NULL REFERENCES cohorts(id),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','expired','rejected','cancelled')),
  payment_status      TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','confirmed','rejected','waived')),
  payment_method      TEXT CHECK (payment_method IN ('jazzcash','easypaisa','bank','cash','manual')),
  payment_ref         TEXT,
  proof_path          TEXT,
  amount              INTEGER NOT NULL DEFAULT 0,
  rejection_reason    TEXT,
  source              TEXT NOT NULL DEFAULT 'signup' CHECK (source IN ('signup','admin','renewal','switch')),
  subscription_start  DATE,
  subscription_expiry DATE,
  confirmed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at        TIMESTAMPTZ,
  invite_sent_at      TIMESTAMPTZ,
  reminder7_sent_at   TIMESTAMPTZ,
  reminder3_sent_at   TIMESTAMPTZ,
  expired_at          TIMESTAMPTZ,
  removed_from_groups BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subs_status ON subscriptions(status, created_at);
CREATE INDEX idx_subs_operator ON subscriptions(operator_id, status);
-- No duplicate live subscription for the same person + route + cohort instance
CREATE UNIQUE INDEX uq_subs_live ON subscriptions(subscriber_id, route_id, cohort_id) WHERE status IN ('pending','active');

CREATE TABLE signup_waitlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  route_id    UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','notified','converted','removed')),
  notified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_waitlist_status ON signup_waitlist(status, created_at);
CREATE UNIQUE INDEX uq_waitlist_waiting ON signup_waitlist(route_id, phone) WHERE status = 'waiting';

-- Every outbound message (WhatsApp / console outbox)
CREATE TABLE delivery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID REFERENCES operators(id) ON DELETE CASCADE,
  trip_session_id UUID REFERENCES trip_sessions(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL,
  recipient       TEXT NOT NULL,
  template        TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('simulated','sent','failed')),
  provider_id     TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_created ON delivery_log(created_at DESC);

CREATE TABLE package_features (
  package     TEXT NOT NULL CHECK (package IN ('basic','premium','gold')),
  feature_key TEXT NOT NULL,
  value       JSONB NOT NULL,
  PRIMARY KEY (package, feature_key)
);

CREATE TABLE operator_feature_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  value       JSONB NOT NULL,
  reason      TEXT,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_overrides_operator ON operator_feature_overrides(operator_id);

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID,
  actor_role  TEXT NOT NULL,
  actor_label TEXT,
  operator_id UUID,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE platform_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_phone ON otp_codes(phone, created_at DESC);

-- Default feature matrix (SRS appendix B)
INSERT INTO package_features (package, feature_key, value) VALUES
  ('basic','max_routes','5'),            ('premium','max_routes','20'),            ('gold','max_routes','null'),
  ('basic','max_admins','1'),            ('premium','max_admins','5'),             ('gold','max_admins','null'),
  ('basic','max_conductors','null'),     ('premium','max_conductors','null'),      ('gold','max_conductors','null'),
  ('basic','routes_per_subscriber','1'), ('premium','routes_per_subscriber','1'),  ('gold','routes_per_subscriber','1'),
  ('basic','trip_history_days','30'),    ('premium','trip_history_days','365'),    ('gold','trip_history_days','null'),
  ('basic','passenger_map','true'),      ('premium','passenger_map','true'),       ('gold','passenger_map','true'),
  ('basic','auto_group_post','false'),   ('premium','auto_group_post','true'),     ('gold','auto_group_post','true'),
  ('basic','eta_prediction','false'),    ('premium','eta_prediction','true'),      ('gold','eta_prediction','true'),
  ('basic','custom_branding','false'),   ('premium','custom_branding','true'),     ('gold','custom_branding','true'),
  ('basic','api_access','false'),        ('premium','api_access','false'),         ('gold','api_access','true'),
  ('basic','sla','"none"'),              ('premium','sla','"99.5%"'),              ('gold','sla','"99.9%"'),
  ('basic','support','"email"'),         ('premium','support','"priority"'),       ('gold','support','"dedicated"');

INSERT INTO platform_config (key, value) VALUES
  ('force_signup_window', 'false'),
  ('signup_window_a', '{"start":1,"end":5}'),
  ('signup_window_b', '{"start":15,"end":19}'),
  ('renewal_reminder_days', '[7,3]'),
  ('trip_auto_close_minutes', '10'),
  ('platform_name', '"EV Bus Live"');
