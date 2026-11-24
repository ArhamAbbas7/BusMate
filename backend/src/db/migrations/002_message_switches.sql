-- Paid WhatsApp message switches (Developer console -> Paid messages).
-- A switched-off message is not sent; it is logged in delivery_log as 'skipped' so the Outbox still shows it.
ALTER TABLE delivery_log DROP CONSTRAINT IF EXISTS delivery_log_status_check;
ALTER TABLE delivery_log ADD CONSTRAINT delivery_log_status_check CHECK (status IN ('simulated','sent','failed','skipped'));

-- Only overrides are stored; anything missing falls back to the defaults in backend/src/lib/messageSwitches.js
INSERT INTO platform_config (key, value) VALUES
  ('message_switches', '{"signup_received": false, "renewal_reminder_7": false}'),
  ('conductor_stay_signed_in', 'true')
ON CONFLICT (key) DO NOTHING;

-- Superseded by the renewal_reminder_7 / renewal_reminder_3 switches
DELETE FROM platform_config WHERE key = 'renewal_reminder_days';
