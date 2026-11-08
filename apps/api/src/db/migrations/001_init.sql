-- 001_init: core schema for organisations, admins, enrollment, devices, screen sessions, audit.

CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  support_email text,
  support_phone text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text,
  role          text NOT NULL CHECK (role IN ('owner','admin','operator','viewer','member')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_org_idx ON users (org_id);

-- Rotating refresh tokens. A family is one login; reuse of a rotated token revokes the family.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip          text,
  user_agent  text
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE enrollments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by              uuid NOT NULL REFERENCES users(id),
  assigned_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  device_name_hint        text,
  token_hash              text NOT NULL UNIQUE,
  pairing_code_hash       text NOT NULL UNIQUE,
  status                  text NOT NULL DEFAULT 'generated' CHECK (status IN
                            ('generated','scanned','app_opened','permissions_approved','authenticated','connected','expired','revoked')),
  requested_permissions   jsonb NOT NULL DEFAULT '[]',
  required_permissions    jsonb NOT NULL DEFAULT '[]',
  failed_attempts         int NOT NULL DEFAULT 0,
  expires_at              timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  scanned_at              timestamptz,
  app_opened_at           timestamptz,
  permissions_approved_at timestamptz,
  authenticated_at        timestamptz,
  connected_at            timestamptz,
  revoked_at              timestamptz,
  device_id               uuid
);
CREATE INDEX enrollments_org_idx ON enrollments (org_id, created_at DESC);

CREATE TABLE devices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrollment_id         uuid REFERENCES enrollments(id) ON DELETE SET NULL,
  assigned_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  name                  text NOT NULL,
  platform              text NOT NULL CHECK (platform IN ('android','ios')),
  manufacturer          text,
  model                 text,
  os_version            text,
  app_version           text,
  installation_id       text NOT NULL,
  secret_hash           text NOT NULL,
  secret_version        int NOT NULL DEFAULT 1,
  secret_rotated_at     timestamptz NOT NULL DEFAULT now(),
  lifecycle_status      text NOT NULL DEFAULT 'authenticated' CHECK (lifecycle_status IN ('authenticated','suspended','revoked')),
  metadata              jsonb NOT NULL DEFAULT '{}',
  ever_connected        boolean NOT NULL DEFAULT false,
  last_seen_at          timestamptz,
  enrolled_at           timestamptz NOT NULL DEFAULT now(),
  suspended_at          timestamptz,
  revoked_at            timestamptz,
  revoke_reason         text
);
CREATE INDEX devices_org_idx ON devices (org_id);
-- One live registration per installation per org. Revoked rows are kept for history.
CREATE UNIQUE INDEX devices_installation_uq ON devices (org_id, installation_id) WHERE lifecycle_status <> 'revoked';

CREATE TABLE device_telemetry (
  device_id   uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  data        jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_permissions (
  device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key        text NOT NULL,
  status     text NOT NULL CHECK (status IN
               ('not_requested','awaiting_approval','granted','denied','restricted_by_os','revoked','not_supported')),
  required   boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, key)
);

CREATE TABLE permission_history (
  id         bigserial PRIMARY KEY,
  device_id  uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key        text NOT NULL,
  from_status text,
  to_status  text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permission_history_device_idx ON permission_history (device_id, at DESC);

CREATE TABLE screen_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  requested_by  uuid NOT NULL REFERENCES users(id),
  purpose       text NOT NULL,
  status        text NOT NULL CHECK (status IN ('awaiting_consent','connecting','active','ended','rejected','expired','failed')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  consented_at  timestamptz,
  started_at    timestamptz,
  ended_at      timestamptz,
  expires_at    timestamptz NOT NULL,
  end_reason    text
);
CREATE INDEX screen_sessions_org_idx ON screen_sessions (org_id, requested_at DESC);
-- At most one live session per device.
CREATE UNIQUE INDEX screen_sessions_live_uq ON screen_sessions (device_id)
  WHERE status IN ('awaiting_consent','connecting','active');

CREATE TABLE support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  direction   text NOT NULL CHECK (direction IN ('to_device','from_device')),
  sender_id   uuid,
  sender_name text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX support_messages_device_idx ON support_messages (device_id, created_at);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type  text NOT NULL CHECK (actor_type IN ('user','device','system')),
  actor_id    uuid,
  actor_name  text,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  ip          text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs (org_id, id DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_id, id DESC);
