-- Run once on the MySQL database used by traders_competition_2 (Denara competition traders + get_token login).
-- After this, POST /get_token.php with JSON { "username", "password" } is required when password_hash is set.

ALTER TABLE traders_competition_2
  ADD COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL
  COMMENT 'PHP password_hash(); app Denara login verifies via POST get_token.php. NULL = legacy row.';
