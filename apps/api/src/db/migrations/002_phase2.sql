-- 002_phase2: ownership, management mode, remote control, queued commands, org security policy.

ALTER TABLE enrollments ADD COLUMN ownership text NOT NULL DEFAULT 'personal' CHECK (ownership IN ('company','personal'));

ALTER TABLE devices ADD COLUMN ownership text NOT NULL DEFAULT 'personal' CHECK (ownership IN ('company','personal'));
ALTER TABLE devices ADD COLUMN management_mode text NOT NULL DEFAULT 'none' CHECK (management_mode IN ('device_owner','device_admin','none'));
ALTER TABLE devices ADD COLUMN capabilities jsonb NOT NULL DEFAULT '[]';
ALTER TABLE devices ADD COLUMN compliance jsonb;

ALTER TABLE screen_sessions ADD COLUMN control_requested boolean NOT NULL DEFAULT false;
ALTER TABLE screen_sessions ADD COLUMN control_granted boolean NOT NULL DEFAULT false;
ALTER TABLE screen_sessions ADD COLUMN input_count int NOT NULL DEFAULT 0;

CREATE TABLE device_commands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  action        text NOT NULL CHECK (action IN ('lock','reboot','wipe','apply_policy')),
  params        jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN
                  ('pending','sent','succeeded','failed','unsupported','cancelled','expired')),
  requested_by  uuid REFERENCES users(id),
  reason        text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  completed_at  timestamptz,
  error         text
);
CREATE INDEX device_commands_device_idx ON device_commands (device_id, created_at DESC);
CREATE INDEX device_commands_open_idx ON device_commands (device_id) WHERE status IN ('pending','sent');

CREATE TABLE org_policies (
  org_id                       uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  version                      int NOT NULL DEFAULT 1,
  passcode                     text NOT NULL DEFAULT 'none' CHECK (passcode IN ('none','low','medium','high')),
  max_screen_lock_timeout_sec  int,
  disable_camera               boolean NOT NULL DEFAULT false,
  disallow_usb_debugging       boolean NOT NULL DEFAULT false,
  disallow_factory_reset       boolean NOT NULL DEFAULT false,
  min_android_patch_age_days   int,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  updated_by                   uuid REFERENCES users(id) ON DELETE SET NULL
);
