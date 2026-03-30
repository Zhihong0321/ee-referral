-- Idempotent migration for append-only preferred-agent audit logging.
ALTER TABLE referral
ADD COLUMN IF NOT EXISTS preferred_agent_log text;
