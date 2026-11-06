const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const getColumnType = require('../utils/getColumnType');
const { ensureSupplierEvaluationsTable } = require('./supplierEvaluationsController');

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const parseOptionalNumericInput = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalizedValue = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;

  if (normalizedValue === '') {
    return null;
  }

  return Number(normalizedValue);
};

const normalizeJsonbInput = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch (err) {
      throw createHttpError(400, `${fieldName} must be valid JSON`);
    }
  }

  try {
    return JSON.stringify(value);
  } catch (err) {
    throw createHttpError(400, `${fieldName} must be valid JSON`);
  }
};

const ALLOWED_SUPPLIER_TYPES = [
  'Manufacturer',
  'Authorized Agent',
  'Authorized Distributor',
  'Sub-distributor',
  'Local Trader',
  'Service Provider',
  'Contractor',
];

const SUPPLIER_CONTACT_SELECT_COLUMNS = `id, supplier_id, name, phone_number, email, position, responsibility, notes, is_primary, created_at, updated_at`;

let supplierContactsEnsured = false;
let supplierContactsEnsuringPromise = null;

const ensureSupplierContactsTable = async () => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("../utils/runtimeSchemaContract").assertModuleContract("controllers/suppliersController.js#ensureSupplierContactsTable", pool);
};

const normalizeSupplierContactPayload = (body = {}, { partial = false } = {}) => {
  const payload = {};
  const fields = ['name', 'phone_number', 'email', 'position', 'responsibility', 'notes'];

  fields.forEach((field) => {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeText(body[field]) || null;
    }
  });

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'is_primary')) {
    payload.is_primary = body.is_primary === true || body.is_primary === 'true';
  }

  return payload;
};

const requireManageSuppliers = (req, next, action) => {
  const canManageSuppliers = req.user?.hasPermission && req.user.hasPermission('contracts.manage');
  if (!canManageSuppliers) {
    next(createHttpError(403, `You are not authorized to ${action} supplier contacts`));
    return false;
  }
  return true;
};

const getSupplierContactById = async (supplierId, contactId) => {
  const { rows } = await pool.query(
    `SELECT ${SUPPLIER_CONTACT_SELECT_COLUMNS}
       FROM supplier_contacts
      WHERE supplier_id = $1 AND id = $2
      LIMIT 1`,
    [supplierId, contactId]
  );
  return rows[0] || null;
};

const listSupplierContacts = async (req, res, next) => {
  const supplierId = Number(req.params.id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureSupplierContactsTable();
    const supplier = await getSupplierById(pool, supplierId);
    if (!supplier) return next(createHttpError(404, 'Supplier not found'));

    const { rows } = await pool.query(
      `SELECT ${SUPPLIER_CONTACT_SELECT_COLUMNS}
         FROM supplier_contacts
        WHERE supplier_id = $1
        ORDER BY is_primary DESC, LOWER(name) ASC, id ASC`,
      [supplierId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list supplier contacts:', err);
    return next(createHttpError(500, 'Failed to load supplier contacts'));
  }
};

const createSupplierContact = async (req, res, next) => {
  if (!requireManageSuppliers(req, next, 'create')) return;
  const supplierId = Number(req.params.id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return next(createHttpError(400, 'Invalid supplier id'));
  const payload = normalizeSupplierContactPayload(req.body);
  if (!payload.name) return next(createHttpError(400, 'Contact name is required'));

  try {
    await ensureSupplierContactsTable();
    const supplier = await getSupplierById(pool, supplierId);
    if (!supplier) return next(createHttpError(404, 'Supplier not found'));

    const { rows } = await pool.query(
      `INSERT INTO supplier_contacts (supplier_id, name, phone_number, email, position, responsibility, notes, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SUPPLIER_CONTACT_SELECT_COLUMNS}`,
      [supplierId, payload.name, payload.phone_number, payload.email, payload.position, payload.responsibility, payload.notes, payload.is_primary]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create supplier contact:', err);
    return next(createHttpError(500, 'Failed to create supplier contact'));
  }
};

const updateSupplierContact = async (req, res, next) => {
  if (!requireManageSuppliers(req, next, 'update')) return;
  const supplierId = Number(req.params.id);
  const contactId = Number(req.params.contactId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return next(createHttpError(400, 'Invalid supplier id'));
  if (!Number.isInteger(contactId) || contactId <= 0) return next(createHttpError(400, 'Invalid contact id'));

  try {
    await ensureSupplierContactsTable();
    const existing = await getSupplierContactById(supplierId, contactId);
    if (!existing) return next(createHttpError(404, 'Supplier contact not found'));

    const payload = normalizeSupplierContactPayload(req.body, { partial: true });
    const updates = [];
    const values = [];
    Object.entries(payload).forEach(([field, value]) => {
      if (field === 'name' && !value) throw createHttpError(400, 'Contact name is required');
      updates.push(`${field} = $${updates.length + 1}`);
      values.push(value);
    });
    if (updates.length === 0) return res.json(existing);
    updates.push('updated_at = NOW()');
    values.push(supplierId, contactId);
    const { rows } = await pool.query(
      `UPDATE supplier_contacts SET ${updates.join(', ')}
        WHERE supplier_id = $${values.length - 1} AND id = $${values.length}
        RETURNING ${SUPPLIER_CONTACT_SELECT_COLUMNS}`,
      values
    );
    return res.json(rows[0]);
  } catch (err) {
    if (err.statusCode) return next(err);
    console.error('❌ Failed to update supplier contact:', err);
    return next(createHttpError(500, 'Failed to update supplier contact'));
  }
};

const deleteSupplierContact = async (req, res, next) => {
  if (!requireManageSuppliers(req, next, 'delete')) return;
  const supplierId = Number(req.params.id);
  const contactId = Number(req.params.contactId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return next(createHttpError(400, 'Invalid supplier id'));
  if (!Number.isInteger(contactId) || contactId <= 0) return next(createHttpError(400, 'Invalid contact id'));

  try {
    await ensureSupplierContactsTable();
    const result = await pool.query('DELETE FROM supplier_contacts WHERE supplier_id = $1 AND id = $2', [supplierId, contactId]);
    if (result.rowCount === 0) return next(createHttpError(404, 'Supplier contact not found'));
    return res.status(204).send();
  } catch (err) {
    console.error('❌ Failed to delete supplier contact:', err);
    return next(createHttpError(500, 'Failed to delete supplier contact'));
  }
};

const SUPPLIER_SELECT_COLUMNS = `id, name, contact_email, contact_phone, supplier_type,
       is_manufacturer, is_authorized_agent, is_authorized_distributor,
       is_sub_distributor, is_service_provider, is_contractor,
       regulatory_risk_level, supplier_category, notes, tax_number, bank_info,
       currency, payment_terms, lead_time_days, credit_limit, status, country,
       created_at, updated_at`;

let suppliersEnsured = false;
let ensuringPromise = null;

const ensureSuppliersTable = async () => {
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("../utils/runtimeSchemaContract").assertModuleContract("controllers/suppliersController.js#ensureSuppliersTable", pool);
};

const resetSuppliersTableCacheForTests = () => {
  suppliersEnsured = false;
  ensuringPromise = null;
  supplierContactsEnsured = false;
  supplierContactsEnsuringPromise = null;
  getColumnType.resetColumnTypeCacheForTests?.();
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
  let bankInfo;

  try {
    bankInfo = normalizeJsonbInput(req.body?.bank_info, 'bank_info');
  } catch (err) {
    return next(err);
  }
  const currency = normalizeText(req.body?.currency) || null;
  const paymentTerms = normalizeText(req.body?.payment_terms) || null;
  const leadTimeDays = parseOptionalNumericInput(req.body?.lead_time_days);
  const creditLimit = parseOptionalNumericInput(req.body?.credit_limit);
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

  if (creditLimit !== null && !Number.isFinite(creditLimit)) {
    return next(createHttpError(400, 'credit_limit must be a valid number'));
  }

  try {
    const supplier = await findOrCreateSupplierByName(pool, name);

    if (contactEmail || contactPhone || supplierType || taxNumber || bankInfo || currency || paymentTerms || leadTimeDays !== null || creditLimit !== null || status || country) {
      const updated = await pool.query(
        `UPDATE suppliers
            SET contact_email = COALESCE($1::text, contact_email),
                contact_phone = COALESCE($2::text, contact_phone),
                supplier_type = COALESCE($3::text, supplier_type),
                tax_number = COALESCE($4::text, tax_number),
                bank_info = COALESCE($5::jsonb, bank_info),
                currency = COALESCE($6::text, currency),
                payment_terms = COALESCE($7::text, payment_terms),
                lead_time_days = COALESCE($8::integer, lead_time_days),
                credit_limit = COALESCE($9::numeric, credit_limit),
                status = COALESCE($10::text, status),
                country = COALESCE($11::text, country),
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
      if (nextSupplierType && !ALLOWED_SUPPLIER_TYPES.includes(nextSupplierType)) {
        return next(createHttpError(400, 'supplier_type must be one of the allowed values'));
      }
      updates.push(`supplier_type = $${updates.length + 1}`);
      values.push(nextSupplierType || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tax_number')) {
      updates.push(`tax_number = $${updates.length + 1}`);
      values.push(normalizeText(req.body.tax_number) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'bank_info')) {
      updates.push(`bank_info = $${updates.length + 1}::jsonb`);
      try {
        values.push(normalizeJsonbInput(req.body.bank_info, 'bank_info'));
      } catch (err) {
        return next(err);
      }
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
      const leadTimeDays = parseOptionalNumericInput(req.body.lead_time_days);
      if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0)) {
        return next(createHttpError(400, 'lead_time_days must be a non-negative integer'));
      }
      updates.push(`lead_time_days = $${updates.length + 1}`);
      values.push(leadTimeDays);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'credit_limit')) {
      const creditLimit = parseOptionalNumericInput(req.body.credit_limit);
      if (creditLimit !== null && !Number.isFinite(creditLimit)) {
        return next(createHttpError(400, 'credit_limit must be a valid number'));
      }
      updates.push(`credit_limit = $${updates.length + 1}`);
      values.push(creditLimit);
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
        high_risk_suppliers: highRiskSuppliersResult.rows,
        expired_authorizations: expiredAuthorizationResult.rows,
      },
    });
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
  ensureSupplierContactsTable,
  listSupplierContacts,
  createSupplierContact,
  updateSupplierContact,
  deleteSupplierContact,
  resetSuppliersTableCacheForTests,
};