-- Run once against the existing eventplanningdb before registering new accounts.
-- Existing accounts remain valid; these fields are nullable for legacy users.
ALTER TABLE app_user
  ADD COLUMN age SMALLINT UNSIGNED NULL,
  ADD COLUMN phone VARCHAR(30) NULL,
  ADD COLUMN city VARCHAR(100) NULL;
