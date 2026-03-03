-- Idempotent migration for environments where referral.project_type does not exist.
ALTER TABLE referral
ADD COLUMN IF NOT EXISTS project_type varchar;

