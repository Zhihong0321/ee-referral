-- Idempotent migration for manager assignment and richer lead location support.
ALTER TABLE referral
ADD COLUMN IF NOT EXISTS assigned_agent varchar;

ALTER TABLE referral
ADD COLUMN IF NOT EXISTS lead_state varchar;

ALTER TABLE referral
ADD COLUMN IF NOT EXISTS lead_city varchar;

ALTER TABLE referral
ADD COLUMN IF NOT EXISTS lead_address varchar;

CREATE INDEX IF NOT EXISTS referral_assigned_agent_idx ON referral (assigned_agent);
CREATE INDEX IF NOT EXISTS referral_status_idx ON referral (status);
