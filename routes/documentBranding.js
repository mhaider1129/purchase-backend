const express = require('express');
const pool = require('../config/db');

const router = express.Router();
const SETTINGS_KEY = 'global';
const MAX_IMAGE_LENGTH = 3 * 1024 * 1024;

let ensureTablePromise;

const ensureTable = () => {
  if (!ensureTablePromise) {
    ensureTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS document_branding_settings (
        key TEXT PRIMARY KEY,
        logo_data TEXT,
        document_code VARCHAR(80),
        template_data TEXT,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }
  return ensureTablePromise;
};

const normalize = (value) => String(value || '').trim().toLowerCase();
const canManage = (user) =>
  normalize(user?.role) === 'admin' ||
  normalize(user?.role) === 'scm' ||
  Boolean(user?.hasPermission?.('departments.manage'));

const validImageData = (value) =>
  value === '' || /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value);

const readSettings = async () => {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT s.logo_data, s.document_code, s.template_data, s.updated_at,
            u.name AS updated_by_name
       FROM document_branding_settings s
       LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.key = $1`,
    [SETTINGS_KEY]
  );
  return rows[0] || {
    logo_data: '',
    document_code: '',
    template_data: '',
    updated_at: null,
    updated_by_name: '',
  };
};

router.get('/', async (_req, res) => {
  try {
    return res.json({ success: true, settings: await readSettings() });
  } catch (error) {
    console.error('❌ load document branding error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load document branding.' });
  }
});

router.put('/', async (req, res) => {
  if (!canManage(req.user)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to manage document branding.' });
  }

  const logoData = typeof req.body?.logo_data === 'string' ? req.body.logo_data.trim() : '';
  const templateData = typeof req.body?.template_data === 'string' ? req.body.template_data.trim() : '';
  const documentCode = typeof req.body?.document_code === 'string' ? req.body.document_code.trim() : '';

  if (documentCode.length > 80) {
    return res.status(400).json({ success: false, message: 'Document code must be 80 characters or fewer.' });
  }
  if (logoData.length > MAX_IMAGE_LENGTH || templateData.length > MAX_IMAGE_LENGTH) {
    return res.status(400).json({ success: false, message: 'Each branding image must be smaller than 2MB.' });
  }
  if (!validImageData(logoData) || !validImageData(templateData)) {
    return res.status(400).json({ success: false, message: 'Branding images must be valid image uploads.' });
  }

  try {
    await ensureTable();
    await pool.query(
      `INSERT INTO document_branding_settings
         (key, logo_data, document_code, template_data, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (key) DO UPDATE SET
         logo_data = EXCLUDED.logo_data,
         document_code = EXCLUDED.document_code,
         template_data = EXCLUDED.template_data,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [SETTINGS_KEY, logoData || null, documentCode || null, templateData || null, req.user.id]
    );
    return res.json({
      success: true,
      settings: await readSettings(),
      message: 'Document branding saved for all users and printouts.',
    });
  } catch (error) {
    console.error('❌ save document branding error:', error);
    return res.status(500).json({ success: false, message: 'Failed to save document branding.' });
  }
});

module.exports = router;
module.exports.canManage = canManage;
module.exports.validImageData = validImageData;