-- Host contact details are private to invitees unless the host opts in.
ALTER TABLE app_user
  ADD COLUMN share_phone_with_invitees BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE invitation
  ADD COLUMN delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN delivery_error VARCHAR(255) NULL;

UPDATE invitation
SET delivery_status = CASE WHEN invitee_user_id IS NULL THEN 'MANUAL_SHARE' ELSE 'IN_APP' END
WHERE delivery_status = 'PENDING';
