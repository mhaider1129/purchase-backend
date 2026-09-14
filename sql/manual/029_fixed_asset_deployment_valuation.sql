-- SQL 029 - Fixed asset initial deployment and acquisition valuation (forward-only)
-- Required deployment: run after SQL 017 and SQL 028. Never edit historical migrations.
BEGIN;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS responsible_section_id integer REFERENCES public.sections(id),
  ADD COLUMN IF NOT EXISTS deployment_date date,
  ADD COLUMN IF NOT EXISTS acquisition_currency varchar(3),
  ADD COLUMN IF NOT EXISTS exchange_rate_to_iqd numeric(24,6),
  ADD COLUMN IF NOT EXISTS acquisition_amount_iqd numeric(24,0),
  ADD COLUMN IF NOT EXISTS exchange_rate_effective_date date,
  ADD COLUMN IF NOT EXISTS exchange_rate_source text;

UPDATE public.assets
   SET acquisition_currency = upper(currency)
 WHERE acquisition_currency IS NULL AND currency IS NOT NULL;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_acquisition_currency_format_ck
    CHECK (acquisition_currency IS NULL OR acquisition_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT assets_exchange_rate_positive_ck
    CHECK (exchange_rate_to_iqd IS NULL OR exchange_rate_to_iqd > 0),
  ADD CONSTRAINT assets_acquisition_amount_iqd_nonnegative_ck
    CHECK (acquisition_amount_iqd IS NULL OR acquisition_amount_iqd >= 0);

-- INITIAL_DEPLOYMENT is an auditable, already-received movement. It initializes
-- the canonical location/responsibility without inventing a second history store.
ALTER TABLE public.asset_movements DROP CONSTRAINT asset_movements_movement_type_check;
ALTER TABLE public.asset_movements ADD CONSTRAINT asset_movements_movement_type_check
  CHECK (movement_type IN ('INITIAL_DEPLOYMENT','PERMANENT_TRANSFER','TEMPORARY_LOAN',
    'MAINTENANCE_TRANSFER','EXTERNAL_MAINTENANCE','RETURN','STORAGE_TRANSFER',
    'DISPOSAL_TRANSFER','LOCATION_CORRECTION'));

CREATE INDEX IF NOT EXISTS assets_responsible_section_idx
  ON public.assets(institute_id,responsible_section_id);

COMMIT;