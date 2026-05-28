-- Optional: if `payout_status` is ENUM and MySQL stores invalid/empty values on UPDATE,
-- migrate to VARCHAR so pending/processing/paid/failed are always storable.
-- Run once on production after backup.

-- ALTER TABLE challenges
--   MODIFY COLUMN payout_status VARCHAR(32) NOT NULL DEFAULT 'not_applicable';
