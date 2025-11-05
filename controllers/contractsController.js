const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const CONTRACT_STATUSES = [
  'draft',
  'active',
  'on-hold',
  'expired',
  'terminated',
  'archived',
];

const ensureContractsTable = (() => {
  let initialized = false;
  let initializingPromise = null;

  return async () => {
    if (initialized) {
      return;
    }

    if (initializingPromise) {
      await initializingPromise;
      return;
    }

    initializingPromise = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contracts (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            vendor TEXT NOT NULL,
            reference_number TEXT,
            start_date DATE,
            end_date DATE,
            contract_value NUMERIC(14, 2),
            status TEXT NOT NULL DEFAULT 'active',
            description TEXT,
            delivery_terms TEXT,
            warranty_terms TEXT,
            performance_management TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS contracts_reference_number_idx
             ON contracts(reference_number)
             WHERE reference_number IS NOT NULL`
        );

        initialized = true;
      } catch (err) {
        console.error('❌ Failed to ensure contracts table exists:', err);
        throw err;
      } finally {
        initializingPromise = null;
      }
    })();

    await initializingPromise;
  };
})();

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeStatus = (value) => {
  const status = normalizeText(value).toLowerCase();
  return CONTRACT_STATUSES.includes(status) ? status : null;
};

const parseISODate = (value, fieldName) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid date`);
  }

  return date.toISOString().slice(0, 10);
};

const parseContractValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    throw createHttpError(400, 'contract_value must be a valid number');
  }

  return numeric;
};

const canManageContracts = (req) => {
  const role = (req.user?.role || '').toUpperCase();
  return (
    role === 'SCM' ||
    role === 'ADMIN' ||
    role === 'PROCUREMENTSPECIALIST' ||
    role === 'COO' ||
    role === 'Medical Devices'
  );
};

const toISODateString = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

const serializeContract = (row) => {
  if (!row) return null;

  const contractValue =
    row.contract_value === null || row.contract_value === undefined
      ? null
      : Number(row.contract_value);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const endDate = row.end_date ? new Date(row.end_date) : null;
  if (endDate && !Number.isNaN(endDate.getTime())) {
    endDate.setHours(0, 0, 0, 0);
  }

  const msInDay = 24 * 60 * 60 * 1000;
  const daysUntilExpiry =
    endDate && !Number.isNaN(endDate.getTime())
      ? Math.ceil((endDate.getTime() - now.getTime()) / msInDay)
      : null;

  return {
    id: row.id,
    title: row.title,
    vendor: row.vendor,
    reference_number: row.reference_number,
    start_date: toISODateString(row.start_date),
    end_date: toISODateString(row.end_date),
    contract_value: Number.isNaN(contractValue) ? null : contractValue,
    status: row.status,
    description: row.description,
    delivery_terms: row.delivery_terms,
    warranty_terms: row.warranty_terms,
    performance_management: row.performance_management,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    days_until_expiry: daysUntilExpiry,
    is_expired: typeof daysUntilExpiry === 'number' ? daysUntilExpiry < 0 : false,
  };
};

const listContracts = async (req, res, next) => {
  try {
    await ensureContractsTable();

    const filters = [];
    const values = [];

    const requestedStatus = req.query.status;
    const search = normalizeText(req.query.search);

    if (requestedStatus && requestedStatus !== 'all') {
      const normalizedStatus = normalizeStatus(requestedStatus);
      if (!normalizedStatus) {
        return next(createHttpError(400, 'Invalid status filter'));
      }
      values.push(normalizedStatus);
      filters.push(`status = $${values.length}`);
    }

    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      const placeholder = `$${values.length}`;
      filters.push(
        `(LOWER(title) LIKE ${placeholder} OR LOWER(vendor) LIKE ${placeholder} OR LOWER(reference_number) LIKE ${placeholder})`
      );
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, title, vendor, reference_number, start_date, end_date, contract_value, status, description,
              delivery_terms, warranty_terms, performance_management, created_by, created_at, updated_at
         FROM contracts
         ${whereClause}
        ORDER BY updated_at DESC NULLS LAST, title ASC`,
      values
    );

    res.json(rows.map(serializeContract));
  } catch (err) {
    console.error('❌ Failed to list contracts:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to fetch contracts'));
  }
};

const getContractById = async (req, res, next) => {
  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  try {
    await ensureContractsTable();
    const { rows } = await pool.query(
      `SELECT id, title, vendor, reference_number, start_date, end_date, contract_value, status, description,
              delivery_terms, warranty_terms, performance_management, created_by, created_at, updated_at
         FROM contracts
        WHERE id = $1
        LIMIT 1`,
      [contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    res.json(serializeContract(rows[0]));
  } catch (err) {
    console.error('❌ Failed to fetch contract:', err);
    next(createHttpError(500, 'Failed to fetch contract'));
  }
};

const createContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to create contracts'));
  }

  const title = normalizeText(req.body?.title);
  const vendor = normalizeText(req.body?.vendor);
  const referenceNumber = normalizeText(req.body?.reference_number) || null;
  const description = normalizeText(req.body?.description) || null;
  const deliveryTerms = normalizeText(req.body?.delivery_terms) || null;
  const warrantyTerms = normalizeText(req.body?.warranty_terms) || null;
  const performanceManagement = normalizeText(req.body?.performance_management) || null;
  const rawStatus = req.body?.status || 'active';

  if (!title) {
    return next(createHttpError(400, 'title is required'));
  }
  if (!vendor) {
    return next(createHttpError(400, 'vendor is required'));
  }

  const status = normalizeStatus(rawStatus);
  if (!status) {
    return next(createHttpError(400, 'status is invalid'));
  }

  let startDate;
  let endDate;
  let contractValue;
  try {
    startDate = parseISODate(req.body?.start_date, 'start_date');
    endDate = parseISODate(req.body?.end_date, 'end_date');
    contractValue = parseContractValue(req.body?.contract_value);
  } catch (err) {
    return next(err);
  }

  if (startDate && endDate && startDate > endDate) {
    return next(createHttpError(400, 'end_date must be after start_date'));
  }

  try {
    await ensureContractsTable();
    const { rows } = await pool.query(
      `INSERT INTO contracts (
         title, vendor, reference_number, start_date, end_date, contract_value, status, description,
         delivery_terms, warranty_terms, performance_management, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, title, vendor, reference_number, start_date, end_date, contract_value, status, description,
                 delivery_terms, warranty_terms, performance_management, created_by, created_at, updated_at`,
      [title, vendor, referenceNumber, startDate, endDate, contractValue, status, description,
       deliveryTerms, warrantyTerms, performanceManagement, req.user?.id || null]
    );

    res.status(201).json(serializeContract(rows[0]));
  } catch (err) {
    if (err?.code === '23505') {
      return next(createHttpError(409, 'A contract with this reference number already exists'));
    }
    console.error('❌ Failed to create contract:', err);
    next(createHttpError(500, 'Failed to create contract'));
  }
};

const updateContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to update contracts'));
  }

  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  let existing;
  try {
    await ensureContractsTable();
    const current = await pool.query(
      `SELECT id, start_date, end_date
         FROM contracts
        WHERE id = $1
        LIMIT 1`,
      [contractId]
    );

    if (current.rowCount === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    existing = current.rows[0];
  } catch (err) {
    console.error('❌ Failed to prepare contract update:', err);
    return next(createHttpError(500, 'Failed to update contract'));
  }

  const assignments = [];
  const values = [];

  const pushAssignment = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  const title = req.body?.title !== undefined ? normalizeText(req.body.title) : undefined;
  const vendor = req.body?.vendor !== undefined ? normalizeText(req.body.vendor) : undefined;
  const referenceNumber =
    req.body?.reference_number !== undefined ? normalizeText(req.body.reference_number) || null : undefined;
  const description = req.body?.description !== undefined ? normalizeText(req.body.description) || null : undefined;
  const deliveryTerms =
    req.body?.delivery_terms !== undefined ? normalizeText(req.body.delivery_terms) || null : undefined;
  const warrantyTerms =
    req.body?.warranty_terms !== undefined ? normalizeText(req.body.warranty_terms) || null : undefined;
  const performanceManagement =
    req.body?.performance_management !== undefined ? normalizeText(req.body.performance_management) || null : undefined;

  if (title !== undefined) {
    if (!title) {
      return next(createHttpError(400, 'title is required'));
    }
    pushAssignment('title', title);
  }

  if (vendor !== undefined) {
    if (!vendor) {
      return next(createHttpError(400, 'vendor is required'));
    }
    pushAssignment('vendor', vendor);
  }

  if (referenceNumber !== undefined) {
    pushAssignment('reference_number', referenceNumber);
  }

  if (description !== undefined) {
    pushAssignment('description', description);
  }

  if (deliveryTerms !== undefined) {
    pushAssignment('delivery_terms', deliveryTerms);
  }

  if (warrantyTerms !== undefined) {
    pushAssignment('warranty_terms', warrantyTerms);
  }

  if (performanceManagement !== undefined) {
    pushAssignment('performance_management', performanceManagement);
  }

  if (req.body?.status !== undefined) {
    const status = normalizeStatus(req.body.status);
    if (!status) {
      return next(createHttpError(400, 'status is invalid'));
    }
    pushAssignment('status', status);
  }

  let requestedStart;
  let startProvided = false;
  if (req.body?.start_date !== undefined) {
    try {
      requestedStart = parseISODate(req.body.start_date, 'start_date');
      startProvided = true;
      pushAssignment('start_date', requestedStart);
    } catch (err) {
      return next(err);
    }
  }

  let requestedEnd;
  let endProvided = false;
  if (req.body?.end_date !== undefined) {
    try {
      requestedEnd = parseISODate(req.body.end_date, 'end_date');
      endProvided = true;
      pushAssignment('end_date', requestedEnd);
    } catch (err) {
      return next(err);
    }
  }

  if (req.body?.contract_value !== undefined) {
    try {
      pushAssignment('contract_value', parseContractValue(req.body.contract_value));
    } catch (err) {
      return next(err);
    }
  }

  if (assignments.length === 0) {
    return next(createHttpError(400, 'No valid fields provided for update'));
  }

  assignments.push('updated_at = NOW()');

  const currentStart = toISODateString(existing.start_date);
  const currentEnd = toISODateString(existing.end_date);
  const nextStart = startProvided ? requestedStart : currentStart;
  const nextEnd = endProvided ? requestedEnd : currentEnd;

  if (nextStart && nextEnd && nextStart > nextEnd) {
    return next(createHttpError(400, 'end_date must be after start_date'));
  }

  try {
    const { rows } = await pool.query(
      `UPDATE contracts
          SET ${assignments.join(', ')}
        WHERE id = $${values.length + 1}
        RETURNING id, title, vendor, reference_number, start_date, end_date, contract_value, status, description,
                  delivery_terms, warranty_terms, performance_management, created_by, created_at, updated_at`,
      [...values, contractId]
    );

    res.json(serializeContract(rows[0]));
  } catch (err) {
    if (err?.code === '23505') {
      return next(createHttpError(409, 'A contract with this reference number already exists'));
    }
    console.error('❌ Failed to update contract:', err);
    next(createHttpError(500, 'Failed to update contract'));
  }
};

const archiveContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to archive contracts'));
  }

  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  try {
    await ensureContractsTable();
    const { rows } = await pool.query(
      `UPDATE contracts
          SET status = 'archived', updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, vendor, reference_number, start_date, end_date, contract_value, status, description,
                  created_by, created_at, updated_at`,
      [contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    res.json(serializeContract(rows[0]));
  } catch (err) {
    console.error('❌ Failed to archive contract:', err);
    next(createHttpError(500, 'Failed to archive contract'));
  }
};

const {
  ensureAttachmentsContractIdColumn,
  attachmentsHasContractIdColumn,
  insertAttachment,
} = require('../utils/attachmentSchema');
const { storeAttachmentFile } = require('../utils/attachmentStorage');
const { serializeAttachment } = require('../utils/attachmentPaths');

const getContractAttachments = async (req, res, next) => {
  const { contractId } = req.params;

  try {
    await ensureAttachmentsContractIdColumn(pool);

    const supportsContractAttachments = await attachmentsHasContractIdColumn(pool);
    if (!supportsContractAttachments) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT id, file_name, file_path, uploaded_by, uploaded_at
       FROM attachments
       WHERE contract_id = $1`,
      [contractId]
    );

    res.json(result.rows.map(serializeAttachment));
  } catch (err) {
    console.error('❌ Failed to fetch attachments:', err.message);
    next(createHttpError(500, 'Failed to fetch attachments'));
  }
};

const uploadContractAttachment = async (req, res, next) => {
  const { contractId } = req.params;
  const file = req.file;

  if (!file) return next(createHttpError(400, 'No file uploaded'));

  try {
    await ensureAttachmentsContractIdColumn(pool);

    const supportsContractAttachments = await attachmentsHasContractIdColumn(pool);
    if (!supportsContractAttachments) {
      return next(
        createHttpError(
          400,
          'Contract-level attachments are not supported by the current database schema'
        )
      );
    }

    const { objectKey } = await storeAttachmentFile({
      file,
      requestId: null,
      itemId: null,
      contractId,
    });

    const saved = await insertAttachment(pool, {
      requestId: null,
      itemId: null,
      contractId,
      fileName: file.originalname,
      filePath: objectKey,
      uploadedBy: req.user.id,
    });

    res.status(201).json({
      message: '📎 File uploaded successfully',
      attachmentId: saved.rows[0].id
    });
  } catch (err) {
    console.error('❌ Upload error:', err.message);
    if (err.code === 'SUPABASE_NOT_CONFIGURED') {
      return next(
        createHttpError(
          500,
          'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        )
      );
    }

    return next(createHttpError(500, 'Failed to upload attachment'));
  }
};

module.exports = {
  listContracts,
  getContractById,
  createContract,
  updateContract,
  archiveContract,
  CONTRACT_STATUSES,
  getContractAttachments,
  uploadContractAttachment,
};