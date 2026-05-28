-- Same as api dtraderhub/migrations/add_challenges_payout_audit_columns.sql
ALTER TABLE challenges
  ADD COLUMN payout_deriv_txid VARCHAR(64) NULL DEFAULT NULL COMMENT 'Deriv paymentagent_transfer tx id' AFTER payout_status,
  ADD COLUMN payout_paid_at DATETIME NULL DEFAULT NULL COMMENT 'UTC when transfer completed' AFTER payout_deriv_txid,
  ADD COLUMN payout_last_error TEXT NULL COMMENT 'Last payout failure' AFTER payout_paid_at;
