BEGIN;

UPDATE suppliers
   SET supplier_type = 'Local Trader'
 WHERE supplier_type IS NULL
    OR TRIM(supplier_type) = ''
    OR supplier_type NOT IN (
      'Manufacturer',
      'Authorized Agent',
      'Authorized Distributor',
      'Sub-distributor',
      'Local Trader',
      'Service Provider',
      'Contractor'
    );

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_manufacturer BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_authorized_agent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_authorized_distributor BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_sub_distributor BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_service_provider BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_contractor BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS regulatory_risk_level VARCHAR DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS supplier_category VARCHAR NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL;

ALTER TABLE suppliers
  ALTER COLUMN supplier_type SET DEFAULT 'Local Trader',
  ALTER COLUMN supplier_type SET NOT NULL;

UPDATE suppliers
   SET regulatory_risk_level = 'medium'
 WHERE regulatory_risk_level IS NULL
    OR TRIM(regulatory_risk_level) = ''
    OR regulatory_risk_level NOT IN ('low', 'medium', 'high', 'critical');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_supplier_type_allowed_chk'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_supplier_type_allowed_chk
      CHECK (supplier_type IN (
        'Manufacturer',
        'Authorized Agent',
        'Authorized Distributor',
        'Sub-distributor',
        'Local Trader',
        'Service Provider',
        'Contractor'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_regulatory_risk_level_allowed_chk'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_regulatory_risk_level_allowed_chk
      CHECK (regulatory_risk_level IN ('low', 'medium', 'high', 'critical'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_principals (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  principal_name VARCHAR(255) NOT NULL,
  principal_country VARCHAR(120) NULL,
  relationship_type VARCHAR(80) NOT NULL,
  authorization_status VARCHAR(80) DEFAULT 'Pending Verification',
  authorization_start_date DATE NULL,
  authorization_expiry_date DATE NULL,
  authorized_categories TEXT[] NULL,
  authorized_brands TEXT[] NULL,
  authorization_document_url TEXT NULL,
  verification_notes TEXT NULL,
  verified_by INTEGER NULL REFERENCES users(id),
  verified_at TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_principals_relationship_type_allowed_chk CHECK (relationship_type IN (
    'Manufacturer',
    'Exclusive Agent',
    'Non-Exclusive Agent',
    'Authorized Distributor',
    'Sub-distributor',
    'Service Partner',
    'Maintenance Partner'
  )),
  CONSTRAINT supplier_principals_authorization_status_allowed_chk CHECK (authorization_status IN (
    'Pending Verification',
    'Verified',
    'Expired',
    'Rejected',
    'Suspended'
  )),
  CONSTRAINT supplier_principals_date_range_chk CHECK (
    authorization_expiry_date IS NULL
    OR authorization_start_date IS NULL
    OR authorization_expiry_date >= authorization_start_date
  )
);

CREATE INDEX IF NOT EXISTS supplier_principals_supplier_id_idx ON supplier_principals(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_principals_principal_name_idx ON supplier_principals(principal_name);
CREATE INDEX IF NOT EXISTS supplier_principals_authorization_status_idx ON supplier_principals(authorization_status);
CREATE INDEX IF NOT EXISTS supplier_principals_authorization_expiry_date_idx ON supplier_principals(authorization_expiry_date);
CREATE INDEX IF NOT EXISTS suppliers_supplier_type_idx ON suppliers(supplier_type);
CREATE INDEX IF NOT EXISTS suppliers_regulatory_risk_level_idx ON suppliers(regulatory_risk_level);

COMMIT;