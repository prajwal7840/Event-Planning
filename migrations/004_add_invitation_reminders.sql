-- Tracks when an invitee was reminded so each reminder is sent only once.
ALTER TABLE invitation
  ADD COLUMN reminder_sent_at TIMESTAMP NULL DEFAULT NULL;
