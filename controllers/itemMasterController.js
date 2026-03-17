const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureItemMasterTables = require('../utils/ensureItemMasterTables');

const ALLOWED_CLASSIFICATIONS = new Set([
  'medication',
  'medical_supply',
  'medical_device',
  'laboratory_item',
  'maintenance_spare_part',
  'it_item',
  'stationery',
  'general_item',
]);

const ALLOWED_DOCUMENT_TYPES = new Set([
  'catalogue',
  'coa_coc',
  'msds',
  'registration_certificate',
  'technical_datasheet',
]);

const toTrimmed = value => (value == null ? '' : String(value).trim());

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'y'].includes(normalized);
};

const parseNonNegative = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, `${fieldName} must be a non-negative number`);
  }
  return parsed;
};

const parseJsonArray = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  throw createHttpError(400, `${fieldName} must be an array`);
};

const normalizePayload = payload => {
  const itemCode = toTrimmed(payload.item_code).toUpperCase();
  const itemName = toTrimmed(payload.item_name);
  const category = toTrimmed(payload.category);
  const itemClassification = toTrimmed(payload.item_classification).toLowerCase();
  const unitOfMeasure = toTrimmed(payload.unit_of_measure);

  if (!itemCode) throw createHttpError(400, 'item_code is required');
  if (!itemName) throw createHttpError(400, 'item_name is required');
  if (!category) throw createHttpError(400, 'category is required');
  if (!unitOfMeasure) throw createHttpError(400, 'unit_of_measure is required');
  if (!ALLOWED_CLASSIFICATIONS.has(itemClassification)) {
    throw createHttpError(400, 'item_classification is invalid');
  }

  return {
    item_code: itemCode,
    item_name: itemName,
    generic_name: toTrimmed(payload.generic_name) || null,
    brand_name: toTrimmed(payload.brand_name) || null,
    category,
    subcategory: toTrimmed(payload.subcategory) || null,
    item_classification: itemClassification,
    unit_of_measure: unitOfMeasure,
    pack_size: toTrimmed(payload.pack_size) || null,
    specifications: toTrimmed(payload.specifications) || null,
    storage_condition: toTrimmed(payload.storage_condition) || null,
    batch_controlled: parseBoolean(payload.batch_controlled),
    expiry_controlled: parseBoolean(payload.expiry_controlled),
    serial_controlled: parseBoolean(payload.serial_controlled),
    standard_cost: parseNonNegative(payload.standard_cost, 'standard_cost'),
    preferred_suppliers: parseJsonArray(payload.preferred_suppliers, 'preferred_suppliers'),
    contract_eligibility: parseBoolean(payload.contract_eligibility),
    reorder_level: parseNonNegative(payload.reorder_level, 'reorder_level'),
    safety_stock: parseNonNegative(payload.safety_stock, 'safety_stock'),
    institute_applicability: parseJsonArray(payload.institute_applicability, 'institute_applicability'),
  };
};

const listItems = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.view')) {
    return next(createHttpError(403, 'You do not have permission to view item master'));
  }

  const queryTerm = toTrimmed(req.query.q).toLowerCase();
  const status = toTrimmed(req.query.status).toLowerCase();
  const classification = toTrimmed(req.query.item_classification).toLowerCase();

  try {
    await ensureItemMasterTables();

    const params = [];
    const filters = [];

    if (queryTerm) {
      params.push(`%${queryTerm}%`);
      filters.push(`(
        LOWER(item_code) LIKE $${params.length}
        OR LOWER(item_name) LIKE $${params.length}
        OR LOWER(COALESCE(generic_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(brand_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(unit_of_measure, '')) LIKE $${params.length}
        OR LOWER(COALESCE(specifications, '')) LIKE $${params.length}
      )`);
    }

    if (status) {
      params.push(status);
      filters.push(`status = $${params.length}`);
    }

    if (classification) {
      params.push(classification);
      filters.push(`item_classification = $${params.length}`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM item_master_items ${whereClause} ORDER BY updated_at DESC, item_name ASC`,
      params,
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list item master records:', err);
    next(createHttpError(500, 'Failed to load item master records'));
  }
};

const getItemById = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.view')) {
    return next(createHttpError(403, 'You do not have permission to view item master'));
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid item id'));

  try {
    await ensureItemMasterTables();

    const itemRes = await pool.query('SELECT * FROM item_master_items WHERE id = $1', [itemId]);
    if (itemRes.rowCount === 0) return next(createHttpError(404, 'Item not found'));

    const docsRes = await pool.query(
      `SELECT id, document_type, document_name, file_path, metadata, uploaded_by, uploaded_at
       FROM item_master_documents
       WHERE item_id = $1
       ORDER BY uploaded_at DESC`,
      [itemId],
    );

    res.json({ ...itemRes.rows[0], documents: docsRes.rows });
  } catch (err) {
    console.error('❌ Failed to fetch item master record:', err);
    next(createHttpError(500, 'Failed to fetch item master record'));
  }
};

const createItem = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.manage')) {
    return next(createHttpError(403, 'You do not have permission to create item master records'));
  }

  let payload;
  try {
    payload = normalizePayload(req.body || {});
  } catch (err) {
    return next(err);
  }

  const userId = req.user?.id ?? null;

  try {
    await ensureItemMasterTables();

    const { rows } = await pool.query(
      `INSERT INTO item_master_items (
        item_code, item_name, generic_name, brand_name, category, subcategory,
        item_classification, unit_of_measure, pack_size, specifications,
        storage_condition, batch_controlled, expiry_controlled, serial_controlled,
        standard_cost, preferred_suppliers, contract_eligibility, reorder_level,
        safety_stock, institute_applicability, created_by, updated_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22
      ) RETURNING *`,
      [
        payload.item_code,
        payload.item_name,
        payload.generic_name,
        payload.brand_name,
        payload.category,
        payload.subcategory,
        payload.item_classification,
        payload.unit_of_measure,
        payload.pack_size,
        payload.specifications,
        payload.storage_condition,
        payload.batch_controlled,
        payload.expiry_controlled,
        payload.serial_controlled,
        payload.standard_cost,
        JSON.stringify(payload.preferred_suppliers),
        payload.contract_eligibility,
        payload.reorder_level,
        payload.safety_stock,
        JSON.stringify(payload.institute_applicability),
        userId,
        userId,
      ],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return next(createHttpError(409, 'item_code already exists'));
    }
    console.error('❌ Failed to create item master record:', err);
    next(createHttpError(500, 'Failed to create item master record'));
  }
};

const updateItem = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.manage')) {
    return next(createHttpError(403, 'You do not have permission to update item master records'));
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid item id'));

  let payload;
  try {
    payload = normalizePayload(req.body || {});
  } catch (err) {
    return next(err);
  }

  const userId = req.user?.id ?? null;

  try {
    await ensureItemMasterTables();

    const { rows } = await pool.query(
      `UPDATE item_master_items
          SET item_code = $2,
              item_name = $3,
              generic_name = $4,
              brand_name = $5,
              category = $6,
              subcategory = $7,
              item_classification = $8,
              unit_of_measure = $9,
              pack_size = $10,
              specifications = $11,
              storage_condition = $12,
              batch_controlled = $13,
              expiry_controlled = $14,
              serial_controlled = $15,
              standard_cost = $16,
              preferred_suppliers = $17,
              contract_eligibility = $18,
              reorder_level = $19,
              safety_stock = $20,
              institute_applicability = $21,
              updated_by = $22,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status IN ('draft', 'rejected')
      RETURNING *`,
      [
        itemId,
        payload.item_code,
        payload.item_name,
        payload.generic_name,
        payload.brand_name,
        payload.category,
        payload.subcategory,
        payload.item_classification,
        payload.unit_of_measure,
        payload.pack_size,
        payload.specifications,
        payload.storage_condition,
        payload.batch_controlled,
        payload.expiry_controlled,
        payload.serial_controlled,
        payload.standard_cost,
        JSON.stringify(payload.preferred_suppliers),
        payload.contract_eligibility,
        payload.reorder_level,
        payload.safety_stock,
        JSON.stringify(payload.institute_applicability),
        userId,
      ],
    );

    if (rows.length === 0) {
      return next(createHttpError(400, 'Only draft or rejected items can be updated'));
    }

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return next(createHttpError(409, 'item_code already exists'));
    }
    console.error('❌ Failed to update item master record:', err);
    next(createHttpError(500, 'Failed to update item master record'));
  }
};

const submitForApproval = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.manage')) {
    return next(createHttpError(403, 'You do not have permission to submit item master records'));
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid item id'));

  try {
    await ensureItemMasterTables();

    const { rows } = await pool.query(
      `UPDATE item_master_items
          SET status = 'pending_approval',
              submitted_by = $2,
              submitted_at = CURRENT_TIMESTAMP,
              rejection_reason = NULL,
              updated_by = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status IN ('draft', 'rejected')
      RETURNING *`,
      [itemId, req.user.id],
    );

    if (rows.length === 0) {
      return next(createHttpError(400, 'Only draft or rejected items can be submitted'));
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to submit item:', err);
    next(createHttpError(500, 'Failed to submit item for approval'));
  }
};

const approveItem = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.approve')) {
    return next(createHttpError(403, 'You do not have permission to approve item master records'));
  }

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid item id'));

  try {
    await ensureItemMasterTables();

    const { rows } = await pool.query(
      `UPDATE item_master_items
          SET status = 'active',
              approved_by = $2,
              approved_at = CURRENT_TIMESTAMP,
              rejection_reason = NULL,
              updated_by = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status = 'pending_approval'
      RETURNING *`,
      [itemId, req.user.id],
    );

    if (rows.length === 0) {
      return next(createHttpError(400, 'Only pending items can be approved'));
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to approve item:', err);
    next(createHttpError(500, 'Failed to approve item'));
  }
};

const rejectItem = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.approve')) {
    return next(createHttpError(403, 'You do not have permission to reject item master records'));
  }

  const itemId = Number(req.params.id);
  const reason = toTrimmed(req.body?.reason);

  if (!Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid item id'));
  if (!reason) return next(createHttpError(400, 'Rejection reason is required'));

  try {
    await ensureItemMasterTables();

    const { rows } = await pool.query(
      `UPDATE item_master_items
          SET status = 'rejected',
              rejection_reason = $3,
              approved_by = NULL,
              approved_at = NULL,
              updated_by = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status = 'pending_approval'
      RETURNING *`,
      [itemId, req.user.id, reason],
    );

    if (rows.length === 0) {
      return next(createHttpError(400, 'Only pending items can be rejected'));
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to reject item:', err);
    next(createHttpError(500, 'Failed to reject item'));
  }
};

const addDocument = async (req, res, next) => {
  if (!req.user?.hasPermission('item-master.manage')) {
    return next(createHttpError(403, 'You do not have permission to attach item documents'));
  }

  const itemId = Number(req.params.id);
  const documentType = toTrimmed(req.body?.document_type).toLowerCase();
  const documentName = toTrimmed(req.body?.document_name);

  if (!Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid item id'));
  if (!ALLOWED_DOCUMENT_TYPES.has(documentType)) return next(createHttpError(400, 'Invalid document_type'));
  if (!documentName) return next(createHttpError(400, 'document_name is required'));

  try {
    await ensureItemMasterTables();

    const itemRes = await pool.query('SELECT id FROM item_master_items WHERE id = $1', [itemId]);
    if (itemRes.rowCount === 0) return next(createHttpError(404, 'Item not found'));

    const { rows } = await pool.query(
      `INSERT INTO item_master_documents
        (item_id, document_type, document_name, file_path, metadata, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        itemId,
        documentType,
        documentName,
        toTrimmed(req.body?.file_path) || null,
        req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
        req.user.id,
      ],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to add item document:', err);
    next(createHttpError(500, 'Failed to add item document'));
  }
};

module.exports = {
  listItems,
  getItemById,
  createItem,
  updateItem,
  submitForApproval,
  approveItem,
  rejectItem,
  addDocument,
};