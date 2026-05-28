-- Same as api dtraderhub/migrations/add_password_hash_traders_competition_2.sql — run on the DB that serves get_token.php / traders registration.

ALTER TABLE traders_competition_2
  ADD COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL
  COMMENT 'PHP password_hash() for Denara ID login; NULL = legacy row (GET username still works until password is set)';
