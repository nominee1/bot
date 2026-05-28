-- Per-challenge statement ranking. Run once on the challenges database (same DB as `config.php`).
-- Fixes: Unknown column 'ranking_status' in 'SELECT' when listing challenges.
--
-- Option A (recommended): idempotent — safe if run multiple times; uses a temporary procedure.
-- Paste into phpMyAdmin SQL tab or: mysql -u USER -p DBNAME < add_challenges_ranking_columns.sql
--
DELIMITER $$

DROP PROCEDURE IF EXISTS denara_add_challenges_ranking_columns$$

CREATE PROCEDURE denara_add_challenges_ranking_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'challenges'
      AND COLUMN_NAME = 'ranking_status'
  ) THEN
    ALTER TABLE challenges
      ADD COLUMN ranking_status VARCHAR(20) NULL DEFAULT NULL COMMENT 'pending|processing|done|skipped|failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'challenges'
      AND COLUMN_NAME = 'ranking_json'
  ) THEN
    ALTER TABLE challenges ADD COLUMN ranking_json LONGTEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'challenges'
      AND COLUMN_NAME = 'ranking_last_error'
  ) THEN
    ALTER TABLE challenges ADD COLUMN ranking_last_error TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'challenges'
      AND COLUMN_NAME = 'ranking_computed_at'
  ) THEN
    ALTER TABLE challenges ADD COLUMN ranking_computed_at DATETIME NULL;
  END IF;
END$$

DELIMITER ;

CALL denara_add_challenges_ranking_columns();
DROP PROCEDURE IF EXISTS denara_add_challenges_ranking_columns;

-- Option B (single-shot, fails if columns already exist): uncomment and run only on empty DB / first deploy.
-- ALTER TABLE challenges
--     ADD COLUMN ranking_status VARCHAR(20) NULL DEFAULT NULL COMMENT 'pending|processing|done|skipped|failed' AFTER winner_return_pct,
--     ADD COLUMN ranking_json LONGTEXT NULL AFTER ranking_status,
--     ADD COLUMN ranking_last_error TEXT NULL AFTER ranking_json,
--     ADD COLUMN ranking_computed_at DATETIME NULL AFTER ranking_last_error;
