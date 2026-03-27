-- Idempotent patch for legacy referral rows used by the referral portal manager queue.
UPDATE referral
SET status = 'Pending'
WHERE status IS NULL
  OR BTRIM(status) = '';

UPDATE referral AS r
SET
  lead_state = COALESCE(NULLIF(r.lead_state, ''), c.state),
  lead_city = COALESCE(NULLIF(r.lead_city, ''), c.city),
  lead_address = COALESCE(NULLIF(r.lead_address, ''), c.address),
  updated_at = NOW()
FROM customer AS c
WHERE r.linked_invoice = c.customer_id
  AND (
    (r.lead_state IS NULL OR BTRIM(r.lead_state) = '')
    OR (r.lead_city IS NULL OR BTRIM(r.lead_city) = '')
    OR (r.lead_address IS NULL OR BTRIM(r.lead_address) = '')
  );
