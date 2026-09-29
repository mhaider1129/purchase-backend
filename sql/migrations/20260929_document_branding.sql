CREATE TABLE IF NOT EXISTS document_branding_settings (
  key TEXT PRIMARY KEY,
  logo_data TEXT,
  document_code VARCHAR(80),
  template_data TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE document_branding_settings IS
  'Single organization-wide logo, document code, and page template applied to all application printouts.';