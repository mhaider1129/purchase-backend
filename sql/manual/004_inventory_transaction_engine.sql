-- PHASE 3 MANUAL MIGRATION. REVIEW AND RUN MANUALLY; application code never executes this file.
-- IMPORTANT: execute only during an inventory-write maintenance window.
-- This script deliberately uses short, independently committed phases. Do not wrap the whole file in BEGIN/COMMIT.
-- A prior version held locks on multiple inventory relations until the final COMMIT and could deadlock with live writers.

-- =============================================================================
-- PHASE 0: PREFLIGHT (read only)
-- Expected: both invalid_* counts are zero. Stop if either is nonzero.
-- =============================================================================
SELECT
  (SELECT count(*) FROM warehouse_stock_levels WHERE quantity < 0) AS invalid_negative_balances,
  (SELECT count(*) FROM inventory_transactions WHERE quantity = 0) AS invalid_zero_movements,
  (SELECT count(*) FROM (SELECT serial_number FROM warehouse_stock_levels WHERE serial_number IS NOT NULL AND quantity > 0 GROUP BY 1 HAVING count(*) > 1) d) AS duplicate_available_serials;

-- =============================================================================
-- PHASE 1: BALANCE PROJECTION DDL
-- NOWAIT makes this phase fail immediately instead of waiting in a lock cycle.
-- This transaction touches only warehouse_stock_levels and releases its lock at COMMIT.
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';
LOCK TABLE warehouse_stock_levels IN ACCESS EXCLUSIVE MODE NOWAIT;
ALTER TABLE warehouse_stock_levels ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE warehouse_stock_levels ADD COLUMN IF NOT EXISTS batch_number text;
ALTER TABLE warehouse_stock_levels ADD COLUMN IF NOT EXISTS reserved_quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE warehouse_stock_levels DROP CONSTRAINT IF EXISTS warehouse_stock_levels_quantity_nonnegative;
ALTER TABLE warehouse_stock_levels ADD CONSTRAINT warehouse_stock_levels_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
ALTER TABLE warehouse_stock_levels DROP CONSTRAINT IF EXISTS warehouse_stock_levels_reserved_nonnegative;
ALTER TABLE warehouse_stock_levels ADD CONSTRAINT warehouse_stock_levels_reserved_nonnegative CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity) NOT VALID;
ALTER TABLE warehouse_stock_levels DROP CONSTRAINT IF EXISTS warehouse_stock_levels_stock_status_check;
ALTER TABLE warehouse_stock_levels ADD CONSTRAINT warehouse_stock_levels_stock_status_check
  CHECK (stock_status IN ('AVAILABLE','QUARANTINE','BLOCKED','RECALLED','DAMAGED','EXPIRED')) NOT VALID;
COMMIT;

-- =============================================================================
-- PHASE 2: LEDGER COLUMNS
-- This phase locks only inventory_transactions. The institute FK is added NOT VALID
-- in a separate short phase so its referenced-table lock is not held during column work.
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '2min';
LOCK TABLE inventory_transactions IN ACCESS EXCLUSIVE MODE NOWAIT;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS movement_type text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS institute_id integer;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS base_uom text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_quantity numeric;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_uom text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS conversion_factor numeric;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS lot_number text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_document_type text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_document_id text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS source_document_line_id text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversal_of_movement_id integer;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reversed_by_movement_id integer;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS command_fingerprint text;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS posted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
COMMIT;

-- =============================================================================
-- PHASE 3: LEDGER BACKFILL AND CHECKS
-- Existing data is preserved. New engine rows use canonical uppercase movement types.
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5min';
LOCK TABLE inventory_transactions IN ACCESS EXCLUSIVE MODE NOWAIT;
UPDATE inventory_transactions SET movement_type = UPPER(transaction_type) WHERE movement_type IS NULL;
ALTER TABLE inventory_transactions ALTER COLUMN movement_type SET NOT NULL;
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_transaction_type_check CHECK (transaction_type IN
 ('warehouse','department','transfer','receipt','issue','adjustment','recall','GOODS_RECEIPT','GOODS_RECEIPT_REVERSAL','ISSUE','ISSUE_REVERSAL','TRANSFER_DISPATCH','TRANSFER_RECEIPT','POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','QUARANTINE','RELEASE_FROM_QUARANTINE')) NOT VALID;
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_positive_conversion;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_positive_conversion CHECK (conversion_factor IS NULL OR conversion_factor > 0) NOT VALID;
COMMIT;

-- =============================================================================
-- PHASE 4: FOREIGN KEYS (short transactions, NOT VALID to avoid an immediate table scan)
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_institute_id_fkey;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_institute_id_fkey
  FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE RESTRICT NOT VALID;
COMMIT;
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_reversal_of_movement_id_fkey;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_reversal_of_movement_id_fkey
  FOREIGN KEY (reversal_of_movement_id) REFERENCES inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_reversed_by_movement_id_fkey;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_reversed_by_movement_id_fkey
  FOREIGN KEY (reversed_by_movement_id) REFERENCES inventory_transactions(id) ON DELETE RESTRICT NOT VALID;
COMMIT;

-- =============================================================================
-- PHASE 5: TRANSACTION-COMPATIBLE INDEX BUILDS
-- Supabase SQL Editor may wrap submitted SQL in a transaction, where CONCURRENTLY is illegal.
-- These ordinary builds are therefore maintenance-window operations. SHARE NOWAIT permits reads,
-- rejects active writers immediately, and avoids waiting in a lock cycle.
-- =============================================================================
-- Both queries must return zero rows before creating unique indexes.
SELECT idempotency_key, count(*) FROM inventory_transactions WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
SELECT reversal_of_movement_id, count(*) FROM inventory_transactions WHERE reversal_of_movement_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- Must return zero rows. An invalid same-named index makes IF NOT EXISTS skip rebuilding it;
-- have a DBA drop only the reported invalid index before continuing.
SELECT c.relname AS invalid_index
  FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
 WHERE NOT x.indisvalid AND c.relname IN
 ('ux_inventory_transactions_idempotency','ux_inventory_transactions_reversal',
  'ix_inventory_ledger_scope','ix_inventory_balance_lock','ux_available_serial_location');
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10min';
LOCK TABLE inventory_transactions IN SHARE MODE NOWAIT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_transactions_idempotency ON inventory_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_transactions_reversal ON inventory_transactions(reversal_of_movement_id) WHERE reversal_of_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_inventory_ledger_scope ON inventory_transactions(institute_id, warehouse_id, stock_item_id, posted_at DESC);
COMMIT;
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10min';
LOCK TABLE warehouse_stock_levels IN SHARE MODE NOWAIT;
CREATE INDEX IF NOT EXISTS ix_inventory_balance_lock ON warehouse_stock_levels(warehouse_id, stock_item_id, stock_status, batch_number, lot_number, serial_number, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_available_serial_location ON warehouse_stock_levels(serial_number)
 WHERE serial_number IS NOT NULL AND stock_status = 'AVAILABLE' AND quantity > 0;
COMMIT;

-- =============================================================================
-- PHASE 6: IMMUTABILITY TRIGGER
-- DELETE is always rejected for engine-posted rows. UPDATE may change only the reversal link.
-- =============================================================================
CREATE OR REPLACE FUNCTION prevent_posted_inventory_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.idempotency_key IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Posted inventory transactions are immutable; post a reversal';
  END IF;
  IF (to_jsonb(NEW) - 'reversed_by_movement_id') IS DISTINCT FROM
     (to_jsonb(OLD) - 'reversed_by_movement_id') OR
     NEW.reversed_by_movement_id IS NOT DISTINCT FROM OLD.reversed_by_movement_id THEN
    RAISE EXCEPTION 'Posted inventory transactions are immutable; only the reversal link may be set';
  END IF;
  IF OLD.reversed_by_movement_id IS NOT NULL OR NEW.reversed_by_movement_id IS NULL THEN
    RAISE EXCEPTION 'Inventory reversal links cannot be cleared or replaced';
  END IF;
  RETURN NEW;
END $$;
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS trg_inventory_transactions_immutable ON inventory_transactions;
CREATE TRIGGER trg_inventory_transactions_immutable BEFORE UPDATE OR DELETE ON inventory_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_posted_inventory_mutation();
COMMIT;

-- =============================================================================
-- PHASE 7: VALIDATION (run one statement at a time during a quiet period)
-- Validation uses weaker locks than column DDL but can scan the full table.
-- =============================================================================
ALTER TABLE warehouse_stock_levels VALIDATE CONSTRAINT warehouse_stock_levels_quantity_nonnegative;
ALTER TABLE warehouse_stock_levels VALIDATE CONSTRAINT warehouse_stock_levels_reserved_nonnegative;
ALTER TABLE warehouse_stock_levels VALIDATE CONSTRAINT warehouse_stock_levels_stock_status_check;
ALTER TABLE inventory_transactions VALIDATE CONSTRAINT inventory_transactions_transaction_type_check;
ALTER TABLE inventory_transactions VALIDATE CONSTRAINT inventory_transactions_positive_conversion;
ALTER TABLE inventory_transactions VALIDATE CONSTRAINT inventory_transactions_institute_id_fkey;
ALTER TABLE inventory_transactions VALIDATE CONSTRAINT inventory_transactions_reversal_of_movement_id_fkey;
ALTER TABLE inventory_transactions VALIDATE CONSTRAINT inventory_transactions_reversed_by_movement_id_fkey;

-- Post-validation: all queries must return zero rows/counts.
SELECT idempotency_key, count(*) FROM inventory_transactions WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
SELECT * FROM warehouse_stock_levels WHERE quantity < 0 OR reserved_quantity < 0 OR reserved_quantity > quantity;
SELECT count(*) AS invalid_institute_references FROM inventory_transactions it
 WHERE it.institute_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM institutes i WHERE i.id = it.institute_id);