const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { getSupplierById } = require('./suppliersController');
const { checkSupplierAuthorizationForCategory } = require('../services/supplierAuthorizationService');

const SUPPLIER_TYPES = [
  'Manufacturer',
  'Authorized Agent',
  'Authorized Distributor',
  'Sub-distributor',
  'Local Trader',
  'Service Provider',
  'Contractor',
];

const REGULATORY_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

const RELATIONSHIP_TYPES = [
  'Manufacturer',
  'Exclusive Agent',
  'Non-Exclusive Agent',
  'Authorized Distributor',
  'Sub-distributor',
  'Service Partner',
  'Maintenance Partner',
];

const AUTHORIZATION_STATUSES = [
  'Pending Verification',
  'Verified',
  'Expired',
  'Rejected',
  'Suspended',
];

const CLASSIFICATION_FIELDS = [
  'supplier_type',
  'is_manufacturer',
  'is_authorized_agent',
  'is_authorized_distributor',
  'is_sub_distributor',
  'is_service_provider',
  'is_contractor',
  'regulatory_risk_level',
  'supplier_category',
  'notes',
];

const PRINCIPAL_RETURNING = `id, supplier_id, principal_name, principal_country, relationship_type,
  authorization_status, authorization_start_date, authorization_expiry_date,
  authorized_categories, authorized_brands, authorization_document_url,
  verification_notes, verified_by, verified_at, is_active, created_at, updated_at`;

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');
const hasOwn = (object, field) => Object.prototype.hasOwnProperty.call(object || {}, field);

const parseId = (value, label) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createHttpError(400, `Invalid ${label}`);
  }
  return parsed;
};

const normalizeArray = value => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (Array.isArray(value)) {
    return value.map(item => normalizeText(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return null;
};

const parseDate = (value, fieldName) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid date`);
  }
  return date.toISOString().slice(0, 10);
};

const validateDateRange = (startDate, expiryDate) => {
  if (startDate && expiryDate && expiryDate < startDate) {
    throw createHttpError(400, 'authorization_expiry_date cannot be before authorization_start_date');
  }
};

const canManageSuppliers = user => {
  const role = normalizeText(user?.role).toLowerCase();
  return (
    role === 'admin' ||
    role === 'scm' ||
    Boolean(user?.hasAnyPermission?.(['suppliers.manage', 'supplier.manage', 'supplier-srm.manage', 'contracts.manage'])) ||
    Boolean(user?.hasPermission?.('suppliers.manage')) ||
    Boolean(user?.hasPermission?.('supplier.manage')) ||
    Boolean(user?.hasPermission?.('supplier-srm.manage')) ||
    Boolean(user?.hasPermission?.('contracts.manage'))
  );
};

const requireSupplierManagement = (req) => {
  if (!canManageSuppliers(req.user)) {
    throw createHttpError(403, 'You are not authorized to manage suppliers');
  }
};

const ensureSupplierExists = async supplierId => {
  const supplier = await getSupplierById(pool, supplierId);
  if (!supplier) {
    throw createHttpError(404, 'Supplier not found');
  }
  return supplier;
};

const decoratePrincipal = row => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let isExpired = false;
  let daysUntilExpiry = null;

  if (row.authorization_expiry_date) {
    const expiry = new Date(row.authorization_expiry_date);
    expiry.setHours(0, 0, 0, 0);
    daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    isExpired = daysUntilExpiry < 0;
  }

  let expiryStatus = 'Active';
  if (isExpired || row.authorization_status === 'Expired') {
    expiryStatus = 'Expired';
  } else if (daysUntilExpiry !== null && daysUntilExpiry <= 30) {
    expiryStatus = 'Expiring Soon';
  }

  return {
    ...row,
    is_expired: isExpired,
    days_until_expiry: daysUntilExpiry,
    expiry_status: expiryStatus,
  };
};

const listPrincipalsForSupplier = async supplierId => {
  const { rows } = await pool.query(
    `SELECT ${PRINCIPAL_RETURNING}
       FROM supplier_principals
      WHERE supplier_id = $1
      ORDER BY is_active DESC, LOWER(principal_name) ASC`,
    [supplierId]
  );
  return rows.map(decoratePrincipal);
};

const getPrincipal = async (supplierId, principalId) => {
  const { rows } = await pool.query(
    `SELECT ${PRINCIPAL_RETURNING}
       FROM supplier_principals
      WHERE supplier_id = $1 AND id = $2
      LIMIT 1`,
    [supplierId, principalId]
  );
  return rows[0] || null;
};

const listSupplierPrincipals = async (req, res, next) => {
  try {
    const supplierId = parseId(req.params.id, 'supplier id');
    await ensureSupplierExists(supplierId);
    res.json(await listPrincipalsForSupplier(supplierId));
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to load supplier principals'));
  }
};

const updateSupplierClassification = async (req, res, next) => {
  try {
    requireSupplierManagement(req);
    const supplierId = parseId(req.params.id, 'supplier id');
    await ensureSupplierExists(supplierId);

    const fields = [];
    const values = [];
    for (const field of CLASSIFICATION_FIELDS) {
      if (!hasOwn(req.body, field)) continue;
      let value = req.body[field];
      if (field === 'supplier_type') {
        value = normalizeText(value);
        if (!SUPPLIER_TYPES.includes(value)) {
          throw createHttpError(400, 'supplier_type must be one of the allowed values');
        }
      } else if (field === 'regulatory_risk_level') {
        value = normalizeText(value).toLowerCase();
        if (!REGULATORY_RISK_LEVELS.includes(value)) {
          throw createHttpError(400, 'regulatory_risk_level must be low, medium, high, or critical');
        }
      } else if (field === 'supplier_category' || field === 'notes') {
        value = normalizeText(value) || null;
      } else {
        value = Boolean(value);
      }
      values.push(value);
      fields.push(`${field} = $${values.length}`);
    }

    if (fields.length === 0) {
      return res.json(await ensureSupplierExists(supplierId));
    }

    values.push(supplierId);
    const { rows } = await pool.query(
      `UPDATE suppliers
          SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${values.length}
    RETURNING id, name, contact_email, contact_phone, supplier_type, is_manufacturer,
              is_authorized_agent, is_authorized_distributor, is_sub_distributor,
              is_service_provider, is_contractor, regulatory_risk_level,
              supplier_category, notes, tax_number, bank_info, currency, payment_terms,
              lead_time_days, credit_limit, status, country, created_at, updated_at`,
      values
    );

    res.json(rows[0]);
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to update supplier classification'));
  }
};

const createSupplierPrincipal = async (req, res, next) => {
  try {
    requireSupplierManagement(req);
    const supplierId = parseId(req.params.id, 'supplier id');
    await ensureSupplierExists(supplierId);

    const principalName = normalizeText(req.body?.principal_name);
    if (!principalName) throw createHttpError(400, 'principal_name is required');

    const relationshipType = normalizeText(req.body?.relationship_type);
    if (!RELATIONSHIP_TYPES.includes(relationshipType)) {
      throw createHttpError(400, 'relationship_type must be one of the allowed values');
    }

    const authorizationStatus = normalizeText(req.body?.authorization_status) || 'Pending Verification';
    if (!AUTHORIZATION_STATUSES.includes(authorizationStatus)) {
      throw createHttpError(400, 'authorization_status must be one of the allowed values');
    }

    const startDate = parseDate(req.body?.authorization_start_date, 'authorization_start_date') ?? null;
    const expiryDate = parseDate(req.body?.authorization_expiry_date, 'authorization_expiry_date') ?? null;
    validateDateRange(startDate, expiryDate);

    const { rows } = await pool.query(
      `INSERT INTO supplier_principals (
        supplier_id, principal_name, principal_country, relationship_type,
        authorization_status, authorization_start_date, authorization_expiry_date,
        authorized_categories, authorized_brands, authorization_document_url,
        verification_notes, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING ${PRINCIPAL_RETURNING}`,
      [
        supplierId,
        principalName,
        normalizeText(req.body?.principal_country) || null,
        relationshipType,
        authorizationStatus,
        startDate,
        expiryDate,
        normalizeArray(req.body?.authorized_categories) || null,
        normalizeArray(req.body?.authorized_brands) || null,
        normalizeText(req.body?.authorization_document_url) || null,
        normalizeText(req.body?.verification_notes) || null,
        hasOwn(req.body, 'is_active') ? Boolean(req.body.is_active) : true,
      ]
    );

    res.status(201).json(decoratePrincipal(rows[0]));
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to create supplier principal'));
  }
};

const updateSupplierPrincipal = async (req, res, next) => {
  try {
    requireSupplierManagement(req);
    const supplierId = parseId(req.params.id, 'supplier id');
    const principalId = parseId(req.params.principalId, 'principal id');
    await ensureSupplierExists(supplierId);
    const existing = await getPrincipal(supplierId, principalId);
    if (!existing) throw createHttpError(404, 'Supplier principal not found');

    const fields = [];
    const values = [];
    const nextStart = hasOwn(req.body, 'authorization_start_date')
      ? parseDate(req.body.authorization_start_date, 'authorization_start_date')
      : existing.authorization_start_date;
    const nextExpiry = hasOwn(req.body, 'authorization_expiry_date')
      ? parseDate(req.body.authorization_expiry_date, 'authorization_expiry_date')
      : existing.authorization_expiry_date;
    validateDateRange(nextStart, nextExpiry);

    const setField = (field, value) => {
      values.push(value);
      fields.push(`${field} = $${values.length}`);
    };

    for (const field of ['principal_name', 'principal_country', 'authorization_document_url', 'verification_notes']) {
      if (hasOwn(req.body, field)) {
        const value = normalizeText(req.body[field]);
        if (field === 'principal_name' && !value) throw createHttpError(400, 'principal_name is required');
        setField(field, value || null);
      }
    }
    if (hasOwn(req.body, 'relationship_type')) {
      const value = normalizeText(req.body.relationship_type);
      if (!RELATIONSHIP_TYPES.includes(value)) throw createHttpError(400, 'relationship_type must be one of the allowed values');
      setField('relationship_type', value);
    }
    if (hasOwn(req.body, 'authorization_status')) {
      const value = normalizeText(req.body.authorization_status);
      if (!AUTHORIZATION_STATUSES.includes(value)) throw createHttpError(400, 'authorization_status must be one of the allowed values');
      setField('authorization_status', value);
    }
    if (hasOwn(req.body, 'authorization_start_date')) setField('authorization_start_date', nextStart);
    if (hasOwn(req.body, 'authorization_expiry_date')) setField('authorization_expiry_date', nextExpiry);
    if (hasOwn(req.body, 'authorized_categories')) setField('authorized_categories', normalizeArray(req.body.authorized_categories));
    if (hasOwn(req.body, 'authorized_brands')) setField('authorized_brands', normalizeArray(req.body.authorized_brands));
    if (hasOwn(req.body, 'is_active')) setField('is_active', Boolean(req.body.is_active));

    if (fields.length === 0) return res.json(decoratePrincipal(existing));

    values.push(supplierId, principalId);
    const { rows } = await pool.query(
      `UPDATE supplier_principals
          SET ${fields.join(', ')}, updated_at = NOW()
        WHERE supplier_id = $${values.length - 1} AND id = $${values.length}
    RETURNING ${PRINCIPAL_RETURNING}`,
      values
    );
    res.json(decoratePrincipal(rows[0]));
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to update supplier principal'));
  }
};

const deleteSupplierPrincipal = async (req, res, next) => {
  try {
    requireSupplierManagement(req);
    const supplierId = parseId(req.params.id, 'supplier id');
    const principalId = parseId(req.params.principalId, 'principal id');
    await ensureSupplierExists(supplierId);
    const { rows } = await pool.query(
      `UPDATE supplier_principals
          SET is_active = FALSE, updated_at = NOW()
        WHERE supplier_id = $1 AND id = $2
    RETURNING ${PRINCIPAL_RETURNING}`,
      [supplierId, principalId]
    );
    if (rows.length === 0) throw createHttpError(404, 'Supplier principal not found');
    res.json(decoratePrincipal(rows[0]));
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to deactivate supplier principal'));
  }
};

const verifySupplierPrincipal = async (req, res, next) => {
  try {
    requireSupplierManagement(req);
    const supplierId = parseId(req.params.id, 'supplier id');
    const principalId = parseId(req.params.principalId, 'principal id');
    await ensureSupplierExists(supplierId);
    const { rows } = await pool.query(
      `UPDATE supplier_principals
          SET authorization_status = 'Verified', verified_by = $1, verified_at = CURRENT_TIMESTAMP,
              verification_notes = COALESCE($2, verification_notes), updated_at = NOW()
        WHERE supplier_id = $3 AND id = $4
    RETURNING ${PRINCIPAL_RETURNING}`,
      [req.user?.id || null, normalizeText(req.body?.verification_notes) || null, supplierId, principalId]
    );
    if (rows.length === 0) throw createHttpError(404, 'Supplier principal not found');
    res.json(decoratePrincipal(rows[0]));
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to verify supplier principal'));
  }
};

const suspendSupplierPrincipal = async (req, res, next) => {
  try {
    requireSupplierManagement(req);
    const reason = normalizeText(req.body?.reason || req.body?.verification_notes);
    if (!reason) throw createHttpError(400, 'Suspension reason is required');
    const supplierId = parseId(req.params.id, 'supplier id');
    const principalId = parseId(req.params.principalId, 'principal id');
    await ensureSupplierExists(supplierId);
    const { rows } = await pool.query(
      `UPDATE supplier_principals
          SET authorization_status = 'Suspended', verification_notes = $1, updated_at = NOW()
        WHERE supplier_id = $2 AND id = $3
    RETURNING ${PRINCIPAL_RETURNING}`,
      [reason, supplierId, principalId]
    );
    if (rows.length === 0) throw createHttpError(404, 'Supplier principal not found');
    res.json(decoratePrincipal(rows[0]));
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to suspend supplier principal'));
  }
};

const safeQueryRows = async (query, values = []) => {
  try {
    const { rows } = await pool.query(query, values);
    return rows;
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return [];
    throw err;
  }
};

const getSupplierProfile = async (req, res, next) => {
  try {
    const supplierId = parseId(req.params.id, 'supplier id');
    const supplier = await ensureSupplierExists(supplierId);
    const [principals, complianceDocuments, contracts, scorecards] = await Promise.all([
      listPrincipalsForSupplier(supplierId),
      safeQueryRows(`SELECT * FROM supplier_compliance_artifacts WHERE supplier_id = $1 ORDER BY expiry_date ASC NULLS LAST`, [supplierId]),
      safeQueryRows(`SELECT * FROM contracts WHERE supplier_id = $1 ORDER BY created_at DESC`, [supplierId]),
      safeQueryRows(`SELECT * FROM supplier_scorecards WHERE supplier_id = $1 ORDER BY created_at DESC`, [supplierId]),
    ]);

    res.json({
      supplier,
      classification: CLASSIFICATION_FIELDS.reduce((output, field) => ({ ...output, [field]: supplier[field] }), {}),
      principals,
      compliance_documents: complianceDocuments,
      contracts,
      scorecards,
    });
  } catch (err) {
    next(err.statusCode ? err : createHttpError(500, 'Failed to load supplier profile'));
  }
};

module.exports = {
  SUPPLIER_TYPES,
  REGULATORY_RISK_LEVELS,
  RELATIONSHIP_TYPES,
  AUTHORIZATION_STATUSES,
  decoratePrincipal,
  checkSupplierAuthorizationForCategory,
  getSupplierProfile,
  updateSupplierClassification,
  listSupplierPrincipals,
  createSupplierPrincipal,
  updateSupplierPrincipal,
  deleteSupplierPrincipal,
  verifySupplierPrincipal,
  suspendSupplierPrincipal,
};