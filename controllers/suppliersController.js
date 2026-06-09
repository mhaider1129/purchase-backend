const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureSupplierEvaluationsTable } = require('./supplierEvaluationsController');

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const ALLOWED_SUPPLIER_TYPES = [
  'Manufacturer',
  'Authorized Agent',
  'Authorized Distributor',
  'Sub-distributor',
  'Local Trader',
  'Service Provider',
  'Contractor',
];


const SUPPLIER_SELECT_COLUMNS = `id, name, contact_email, contact_phone, supplier_type,
       is_manufacturer, is_authorized_agent, is_authorized_distributor,
       is_sub_distributor, is_service_provider, is_contractor,
       regulatory_risk_level, supplier_category, notes, tax_number, bank_info,
       currency, payment_terms, lead_time_days, credit_limit, status, country,
       created_at, updated_at`;

let suppliersEnsured = false;
let ensuringPromise = null;

const ensureSuppliersTable = async () => {
  if (suppliersEnsured) {
    return;
  }

  if (!ensuringPromise) {
    ensuringPromise = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS suppliers (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            contact_email TEXT,
            contact_phone TEXT,
            supplier_type TEXT,
            tax_number TEXT,
            bank_info JSONB,
            currency TEXT,
            payment_terms TEXT,
            lead_time_days INTEGER,
            credit_limit NUMERIC(18,2),
            status TEXT,
            country TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);


        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_type TEXT`);
        await pool.query(`ALTER TABLE suppliers ALTER COLUMN supplier_type SET DEFAULT 'Local Trader'`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_number TEXT`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_info JSONB`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency TEXT`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(18,2)`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status TEXT`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country TEXT`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_manufacturer BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_authorized_agent BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_authorized_distributor BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_sub_distributor BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_service_provider BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_contractor BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS regulatory_risk_level VARCHAR DEFAULT 'medium'`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_category VARCHAR`);
        await pool.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT`);

        await pool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_ci_idx
            ON suppliers (LOWER(name))
        `);

        suppliersEnsured = true;
      } finally {
        ensuringPromise = null;
      }
    })();
  }

  await ensuringPromise;
};

const getSupplierById = async (client, supplierId) => {
  const parsedId = Number(supplierId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return null;
  }

  await ensureSuppliersTable();
  const executor = client || pool;
  const { rows } = await executor.query(
    `SELECT ${SUPPLIER_SELECT_COLUMNS}
       FROM suppliers
      WHERE id = $1
      LIMIT 1`,
    [parsedId]
  );

  return rows[0] || null;
};

const findOrCreateSupplierByName = async (client, name) => {
  const sanitizedName = normalizeText(name);
  if (!sanitizedName) {
    throw createHttpError(400, 'supplier name is required');
  }

  await ensureSuppliersTable();
  const executor = client || pool;

  const existing = await executor.query(
    `SELECT ${SUPPLIER_SELECT_COLUMNS}
       FROM suppliers
      WHERE LOWER(name) = LOWER($1)
      LIMIT 1`,
    [sanitizedName]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  try {
    const inserted = await executor.query(
      `INSERT INTO suppliers (name)
         VALUES ($1)
         RETURNING ${SUPPLIER_SELECT_COLUMNS}`,
      [sanitizedName]
    );

    return inserted.rows[0];
  } catch (err) {
    if (err?.code === '23505') {
      const retry = await executor.query(
        `SELECT ${SUPPLIER_SELECT_COLUMNS}
           FROM suppliers
          WHERE LOWER(name) = LOWER($1)
          LIMIT 1`,
        [sanitizedName]
      );

      if (retry.rowCount > 0) {
        return retry.rows[0];
      }
    }

    throw err;
  }
};

const listSuppliers = async (req, res, next) => {
  try {
    await ensureSuppliersTable();
    const { rows } = await pool.query(
      `SELECT ${SUPPLIER_SELECT_COLUMNS}
         FROM suppliers
        ORDER BY LOWER(name) ASC`
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list suppliers:', err);
    next(createHttpError(500, 'Failed to load suppliers'));
  }
};

const createSupplier = async (req, res, next) => {
  const canManageSuppliers =
    req.user?.hasPermission && req.user.hasPermission('contracts.manage');

  if (!canManageSuppliers) {
    return next(createHttpError(403, 'You are not authorized to create suppliers'));
  }

  const name = normalizeText(req.body?.name);
  const contactEmail = normalizeText(req.body?.contact_email) || null;
  const contactPhone = normalizeText(req.body?.contact_phone) || null;
  const supplierType = normalizeText(req.body?.supplier_type) || null;
  const taxNumber = normalizeText(req.body?.tax_number) || null;
  const bankInfo = req.body?.bank_info ?? null;
  const currency = normalizeText(req.body?.currency) || null;
  const paymentTerms = normalizeText(req.body?.payment_terms) || null;
  const leadTimeDaysRaw = req.body?.lead_time_days;
  const leadTimeDays = leadTimeDaysRaw === undefined || leadTimeDaysRaw === null || leadTimeDaysRaw === '' ? null : Number(leadTimeDaysRaw);
  const creditLimitRaw = req.body?.credit_limit;
  const creditLimit = creditLimitRaw === undefined || creditLimitRaw === null || creditLimitRaw === '' ? null : Number(creditLimitRaw);
  const status = normalizeText(req.body?.status) || null;
  const country = normalizeText(req.body?.country) || null;

  if (!name) {
    return next(createHttpError(400, 'Supplier name is required'));
  }

  if (supplierType && !ALLOWED_SUPPLIER_TYPES.includes(supplierType)) {
    return next(createHttpError(400, 'supplier_type must be one of the allowed values'));
  }

  if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0)) {
    return next(createHttpError(400, 'lead_time_days must be a non-negative integer'));
  }

  if (creditLimit !== null && Number.isNaN(creditLimit)) {
    return next(createHttpError(400, 'credit_limit must be a valid number'));
  }

  try {
    const supplier = await findOrCreateSupplierByName(pool, name);

    if (contactEmail || contactPhone || supplierType || taxNumber || bankInfo || currency || paymentTerms || leadTimeDays !== null || creditLimit !== null || status || country) {
      const updated = await pool.query(
        `UPDATE suppliers
            SET contact_email = COALESCE($1, contact_email),
                contact_phone = COALESCE($2, contact_phone),
                supplier_type = COALESCE($3, supplier_type),
                tax_number = COALESCE($4, tax_number),
                bank_info = COALESCE($5, bank_info),
                currency = COALESCE($6, currency),
                payment_terms = COALESCE($7, payment_terms),
                lead_time_days = COALESCE($8, lead_time_days),
                credit_limit = COALESCE($9, credit_limit),
                status = COALESCE($10, status),
                country = COALESCE($11, country),
                updated_at = NOW()
          WHERE id = $12
        RETURNING ${SUPPLIER_SELECT_COLUMNS}`,
        [contactEmail, contactPhone, supplierType, taxNumber, bankInfo, currency, paymentTerms, leadTimeDays, creditLimit, status, country, supplier.id]
      );

      return res.status(201).json(updated.rows[0]);
    }

    res.status(201).json(supplier);
  } catch (err) {
    console.error('❌ Failed to create supplier:', err);
    next(createHttpError(500, 'Failed to create supplier'));
  }
};

const updateSupplier = async (req, res, next) => {
  const canManageSuppliers =
    req.user?.hasPermission && req.user.hasPermission('contracts.manage');

  if (!canManageSuppliers) {
    return next(createHttpError(403, 'You are not authorized to update suppliers'));
  }

  const supplierId = Number(req.params.id);

  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureSuppliersTable();
    const existing = await getSupplierById(pool, supplierId);

    if (!existing) {
      return next(createHttpError(404, 'Supplier not found'));
    }

    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const newName = normalizeText(req.body.name);

      if (!newName) {
        return next(createHttpError(400, 'Supplier name is required'));
      }

      updates.push(`name = $${updates.length + 1}`);
      values.push(newName);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'contact_email')) {
      updates.push(`contact_email = $${updates.length + 1}`);
      values.push(normalizeText(req.body.contact_email) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'contact_phone')) {
      updates.push(`contact_phone = $${updates.length + 1}`);
      values.push(normalizeText(req.body.contact_phone) || null);
    }


    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'supplier_type')) {
      const nextSupplierType = normalizeText(req.body.supplier_type);
      if (!ALLOWED_SUPPLIER_TYPES.includes(nextSupplierType)) {
        return next(createHttpError(400, 'supplier_type must be one of the allowed values'));
      }
      updates.push(`supplier_type = $${updates.length + 1}`);
      values.push(nextSupplierType);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tax_number')) {
      updates.push(`tax_number = $${updates.length + 1}`);
      values.push(normalizeText(req.body.tax_number) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'bank_info')) {
      updates.push(`bank_info = $${updates.length + 1}`);
      values.push(req.body.bank_info ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'currency')) {
      updates.push(`currency = $${updates.length + 1}`);
      values.push(normalizeText(req.body.currency) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'payment_terms')) {
      updates.push(`payment_terms = $${updates.length + 1}`);
      values.push(normalizeText(req.body.payment_terms) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'lead_time_days')) {
      const leadTimeDays = req.body.lead_time_days;
      if (leadTimeDays !== null && leadTimeDays !== '' && (!Number.isInteger(Number(leadTimeDays)) || Number(leadTimeDays) < 0)) {
        return next(createHttpError(400, 'lead_time_days must be a non-negative integer'));
      }
      updates.push(`lead_time_days = $${updates.length + 1}`);
      values.push(leadTimeDays === '' ? null : (leadTimeDays === null ? null : Number(leadTimeDays)));
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'credit_limit')) {
      const creditLimit = req.body.credit_limit;
      if (creditLimit !== null && creditLimit !== '' && Number.isNaN(Number(creditLimit))) {
        return next(createHttpError(400, 'credit_limit must be a valid number'));
      }
      updates.push(`credit_limit = $${updates.length + 1}`);
      values.push(creditLimit === '' ? null : (creditLimit === null ? null : Number(creditLimit)));
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
      updates.push(`status = $${updates.length + 1}`);
      values.push(normalizeText(req.body.status) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'country')) {
      updates.push(`country = $${updates.length + 1}`);
      values.push(normalizeText(req.body.country) || null);
    }

    if (updates.length === 0) {
      return res.json(existing);
    }

    updates.push(`updated_at = NOW()`);
    values.push(supplierId);

    const query = `UPDATE suppliers
                      SET ${updates.join(', ')}
                    WHERE id = $${values.length}
                RETURNING ${SUPPLIER_SELECT_COLUMNS}`;

    const { rows } = await pool.query(query, values);

    return res.json(rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return next(createHttpError(400, 'A supplier with this name already exists'));
    }

    console.error('❌ Failed to update supplier:', err);
    next(createHttpError(500, 'Failed to update supplier'));
  }
};

const deleteSupplier = async (req, res, next) => {
  const canManageSuppliers =
    req.user?.hasPermission && req.user.hasPermission('contracts.manage');

  if (!canManageSuppliers) {
    return next(createHttpError(403, 'You are not authorized to delete suppliers'));
  }

  const supplierId = Number(req.params.id);

  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureSuppliersTable();
    const existing = await getSupplierById(pool, supplierId);

    if (!existing) {
      return next(createHttpError(404, 'Supplier not found'));
    }

    await pool.query('DELETE FROM suppliers WHERE id = $1', [supplierId]);

    return res.status(204).send();
  } catch (err) {
    if (err?.code === '23503') {
      return next(
        createHttpError(409, 'Supplier is linked to other records and cannot be deleted')
      );
    }

    console.error('❌ Failed to delete supplier:', err);
    next(createHttpError(500, 'Failed to delete supplier'));
  }
};

const getSuppliersDashboard = async (req, res, next) => {
  try {
    await ensureSuppliersTable();
    await ensureSupplierEvaluationsTable();

    const [
      summaryResult,
      coverageResult,
      recentResult,
      suppliersByTypeResult,
      expiringAuthorizationResult,
      unverifiedPrincipalsResult,
      highRiskSuppliersResult,
      expiredAuthorizationResult,
    ] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS total_suppliers,
               SUM(CASE WHEN contact_email IS NOT NULL AND contact_email <> '' THEN 1 ELSE 0 END) AS with_email,
               SUM(CASE WHEN contact_phone IS NOT NULL AND contact_phone <> '' THEN 1 ELSE 0 END) AS with_phone,
               SUM(CASE
                     WHEN (contact_email IS NOT NULL AND contact_email <> '')
                          OR (contact_phone IS NOT NULL AND contact_phone <> '')
                     THEN 1 ELSE 0 END) AS with_contact
          FROM suppliers
      `),
      pool.query(`
        SELECT s.id,
               s.name,
               s.contact_email,
               s.contact_phone,
               s.supplier_type,
               s.currency,
               s.payment_terms,
               s.lead_time_days,
               s.credit_limit,
               s.status,
               s.country,
               MAX(se.evaluation_date) AS last_evaluation_date,
               COUNT(se.id) AS evaluation_count
          FROM suppliers s
     LEFT JOIN supplier_evaluations se ON LOWER(se.supplier_name) = LOWER(s.name)
      GROUP BY s.id, s.name, s.contact_email, s.contact_phone, s.supplier_type, s.currency, s.payment_terms, s.lead_time_days, s.credit_limit, s.status, s.country
      ORDER BY last_evaluation_date DESC NULLS LAST, s.name ASC
         LIMIT 12
      `),
      pool.query(`
        SELECT ${SUPPLIER_SELECT_COLUMNS}
          FROM suppliers
      ORDER BY created_at DESC
         LIMIT 8
      `),
      pool.query(`
        SELECT supplier_type, COUNT(*)::INTEGER AS supplier_count
          FROM suppliers
      GROUP BY supplier_type
      ORDER BY supplier_count DESC, supplier_type ASC
      `),
      pool.query(`
        SELECT sp.id, sp.supplier_id, s.name AS supplier_name, sp.principal_name,
               sp.authorization_expiry_date,
               (sp.authorization_expiry_date - CURRENT_DATE)::INTEGER AS days_until_expiry
          FROM supplier_principals sp
          JOIN suppliers s ON s.id = sp.supplier_id
         WHERE sp.is_active = TRUE
           AND sp.authorization_status = 'Verified'
           AND sp.authorization_expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      ORDER BY sp.authorization_expiry_date ASC
         LIMIT 12
      `),
      pool.query(`
        SELECT COUNT(*)::INTEGER AS total
          FROM supplier_principals
         WHERE is_active = TRUE AND authorization_status = 'Pending Verification'
      `),
      pool.query(`
        SELECT id, name, supplier_type, regulatory_risk_level, supplier_category
          FROM suppliers
         WHERE regulatory_risk_level IN ('high', 'critical')
      ORDER BY CASE regulatory_risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, name ASC
         LIMIT 12
      `),
      pool.query(`
        SELECT sp.id, sp.supplier_id, s.name AS supplier_name, sp.principal_name, sp.authorization_expiry_date
          FROM supplier_principals sp
          JOIN suppliers s ON s.id = sp.supplier_id
         WHERE sp.is_active = TRUE
           AND (sp.authorization_status = 'Expired' OR sp.authorization_expiry_date < CURRENT_DATE)
      ORDER BY sp.authorization_expiry_date ASC NULLS LAST
         LIMIT 12
      `),
    ]);

    const summary = summaryResult.rows[0] || {};
    const totalSuppliers = Number(summary.total_suppliers) || 0;
    const withContact = Number(summary.with_contact) || 0;

    res.json({
      totals: {
        suppliers: totalSuppliers,
        with_email: Number(summary.with_email) || 0,
        with_phone: Number(summary.with_phone) || 0,
        with_contact: withContact,
        without_contact: Math.max(totalSuppliers - withContact, 0),
      },
      coverage: coverageResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        contact_email: row.contact_email,
        contact_phone: row.contact_phone,
        last_evaluation_date: row.last_evaluation_date,
        evaluation_count: Number(row.evaluation_count) || 0,
      })),
      recent_suppliers: recentResult.rows,
      widgets: {
        suppliers_by_type: suppliersByTypeResult.rows,
        expiring_authorizations_30_days: expiringAuthorizationResult.rows,
        unverified_supplier_principals: Number(unverifiedPrincipalsResult.rows[0]?.total) || 0,
        
  } catch (err) {
    console.error('❌ Failed to load suppliers dashboard:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to load suppliers dashboard'));
  }
};

module.exports = {
  ensureSuppliersTable,
  listSuppliers,
  createSupplier,
  getSupplierById,
  findOrCreateSupplierByName,
  getSuppliersDashboard,
  updateSupplier,
  deleteSupplier,
};