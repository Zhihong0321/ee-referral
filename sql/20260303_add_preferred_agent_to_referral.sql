-- Idempotent migration for environments where referral.linked_agent does not exist.
ALTER TABLE referral
ADD COLUMN IF NOT EXISTS linked_agent varchar;

