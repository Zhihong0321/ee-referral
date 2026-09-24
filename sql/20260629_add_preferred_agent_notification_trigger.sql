-- Idempotent outbox + trigger for preferred-agent assignment notifications.
-- The notification event is created by the database whenever referral.linked_agent
-- is set on insert or changed on update. App/worker code claims pending rows and
-- sends the WhatsApp message outside the transaction.

CREATE TABLE IF NOT EXISTS referral_preferred_agent_notification (
  id bigserial PRIMARY KEY,
  referral_id bigint NOT NULL,
  preferred_agent_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS referral_preferred_agent_notification_pending_idx
ON referral_preferred_agent_notification (status, created_at, id)
WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS referral_preferred_agent_notification_referral_idx
ON referral_preferred_agent_notification (referral_id, preferred_agent_id, created_at);

CREATE OR REPLACE FUNCTION enqueue_referral_preferred_agent_notification()
RETURNS trigger AS $$
BEGIN
  IF NEW.linked_agent IS NOT NULL
     AND BTRIM(NEW.linked_agent::text) <> ''
     AND (
       TG_OP = 'INSERT'
       OR NEW.linked_agent IS DISTINCT FROM OLD.linked_agent
     ) THEN
    INSERT INTO referral_preferred_agent_notification (
      referral_id,
      preferred_agent_id
    )
    VALUES (
      NEW.id,
      NEW.linked_agent::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS referral_preferred_agent_notification_enqueue ON referral;

CREATE TRIGGER referral_preferred_agent_notification_enqueue
AFTER INSERT OR UPDATE OF linked_agent ON referral
FOR EACH ROW
EXECUTE FUNCTION enqueue_referral_preferred_agent_notification();
