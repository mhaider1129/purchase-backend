const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const WAREHOUSE_ROLES = new Set([
  'warehousekeeper',
  'warehouse_keeper',
  'warehousemanager',
  'warehouse_manager',
  'scm',
  'admin',
]);

const normalizeRole = (role = '') => role.toLowerCase();

const normalizeCustodyType = (value = '') => {
  const normalized = value.toLowerCase();
  if (normalized === 'personal') return 'Personal';
  if (normalized === 'departmental') return 'Departmental';
  throw createHttpError(400, 'Custody type must be personal or departmental');
};

const computeOverallStatus = (userStatus, hodStatus) => {
  if ([userStatus, hodStatus].includes('Rejected')) {
    return 'Rejected';
  }

  const normalized = [userStatus, hodStatus];
  const allApproved = normalized.every((status) =>
    ['Approved', 'NotRequired'].includes(status),
  );

  return allApproved ? 'Approved' : 'Pending';
};

const findHodForDepartment = async (client, departmentId) => {
  if (!departmentId) return null;

  const { rows } = await client.query(
    `SELECT id
       FROM users
      WHERE department_id = $1
        AND is_active = TRUE
        AND LOWER(role) = 'hod'
      ORDER BY id
      LIMIT 1`,
    [departmentId],
  );

  return rows[0]?.id || null;
};

const fetchCustodyRecordById = async (client, id) => {
  const { rows } = await client.query(
    `SELECT cr.*, 
            issuer.name AS issued_by_name,
            custodian.name AS custodian_name,
            dept.name AS custodian_department_name,
            hod.name AS hod_name
       FROM custody_records cr
       LEFT JOIN users issuer ON issuer.id = cr.issued_by
       LEFT JOIN users custodian ON custodian.id = cr.custodian_user_id
       LEFT JOIN departments dept ON dept.id = cr.custodian_department_id
       LEFT JOIN users hod ON hod.id = cr.hod_user_id
      WHERE cr.id = $1`,
    [id],
  );

  return rows[0] || null;
};

const ensureWarehouseRole = (req) => {
  const role = normalizeRole(req.user?.role);
  if (!WAREHOUSE_ROLES.has(role)) {
    throw createHttpError(403, 'Only supply chain staff can create custody records');
  }
};

const createCustodyRecord = async (req, res, next) => {
  try {
    ensureWarehouseRole(req);
  } catch (err) {
    return next(err);
  }

  const {
    item_name,
    quantity,
    description,
    custody_type,
    custody_code,
    custodian_user_id,
    custodian_department_id,
  } = req.body || {};

  if (!item_name || typeof item_name !== 'string') {
    return next(createHttpError(400, 'Item name is required'));
  }

  const parsedQty = parseInt(quantity, 10);
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return next(createHttpError(400, 'Quantity must be a positive number'));
  }

  let custodyType;
  try {
    custodyType = normalizeCustodyType(custody_type);
  } catch (err) {
    return next(err);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let targetCustodianUserId = null;
    let targetDepartmentId = null;

    if (custodyType === 'Personal') {
      const userId = parseInt(custodian_user_id, 10);
      if (!Number.isFinite(userId)) {
        throw createHttpError(400, 'A valid custodian user is required for personal custody');
      }

      const { rows: userRows } = await client.query(
        `SELECT id, department_id, is_active
           FROM users
          WHERE id = $1`,
        [userId],
      );

      if (userRows.length === 0 || !userRows[0].is_active) {
        throw createHttpError(400, 'Selected custodian user is not active');
      }

      targetCustodianUserId = userRows[0].id;
      targetDepartmentId = userRows[0].department_id;
    } else {
      const departmentId = parseInt(custodian_department_id, 10);
      if (!Number.isFinite(departmentId)) {
        throw createHttpError(400, 'A valid department is required for departmental custody');
      }

      const { rows: departmentRows } = await client.query(
        `SELECT id
           FROM departments
          WHERE id = $1`,
        [departmentId],
      );

      if (departmentRows.length === 0) {
        throw createHttpError(400, 'Selected department does not exist');
      }

      targetDepartmentId = departmentRows[0].id;
    }

    const hodUserId = await findHodForDepartment(
      client,
      targetDepartmentId || parseInt(custodian_department_id, 10) || null,
    );

    const userApprovalStatus = targetCustodianUserId ? 'Pending' : 'NotRequired';
    const hodApprovalStatus = hodUserId ? 'Pending' : 'NotRequired';
    const overallStatus = computeOverallStatus(userApprovalStatus, hodApprovalStatus);

    const insertValues = [
      item_name.trim(),
      parsedQty,
      description ?? null,
      custodyType,
      custody_code ?? null,
      req.user.id,
      targetCustodianUserId,
      targetDepartmentId || parseInt(custodian_department_id, 10) || null,
      hodUserId,
      userApprovalStatus,
      hodApprovalStatus,
      overallStatus,
    ];

    const { rows } = await client.query(
      `INSERT INTO custody_records (
         item_name,
         quantity,
         description,
         custody_type,
         custody_code,
         issued_by,
         custodian_user_id,
         custodian_department_id,
         hod_user_id,
         user_approval_status,
         hod_approval_status,
         status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      insertValues,
    );

    const recordId = rows[0].id;
    await client.query('COMMIT');

    const record = await fetchCustodyRecordById(client, recordId);
    res.status(201).json({
      message: 'Custody record created successfully',
      record,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create custody record:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to create custody record'));
  } finally {
    client.release();
  }
};

const getPendingCustodyApprovals = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT cr.*, 
              issuer.name AS issued_by_name,
              custodian.name AS custodian_name,
              dept.name AS custodian_department_name,
              hod.name AS hod_name,
              CASE
                WHEN cr.custodian_user_id = $1 AND cr.user_approval_status = 'Pending' THEN 'custodian'
                WHEN cr.hod_user_id = $1 AND cr.hod_approval_status = 'Pending' THEN 'hod'
                ELSE NULL
              END AS pending_role
         FROM custody_records cr
         LEFT JOIN users issuer ON issuer.id = cr.issued_by
         LEFT JOIN users custodian ON custodian.id = cr.custodian_user_id
         LEFT JOIN departments dept ON dept.id = cr.custodian_department_id
         LEFT JOIN users hod ON hod.id = cr.hod_user_id
        WHERE (cr.custodian_user_id = $1 AND cr.user_approval_status = 'Pending')
           OR (cr.hod_user_id = $1 AND cr.hod_approval_status = 'Pending')
        ORDER BY cr.created_at DESC`,
      [userId],
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch custody approvals:', err);
    next(createHttpError(500, 'Failed to load custody approvals'));
  }
};

const listIssuedCustodies = async (req, res, next) => {
  try {
    ensureWarehouseRole(req);
  } catch (err) {
    return next(err);
  }

  try {
    const { rows } = await pool.query(
      `SELECT cr.*,
              issuer.name AS issued_by_name,
              custodian.name AS custodian_name,
              dept.name AS custodian_department_name,
              hod.name AS hod_name
         FROM custody_records cr
         LEFT JOIN users issuer ON issuer.id = cr.issued_by
         LEFT JOIN users custodian ON custodian.id = cr.custodian_user_id
         LEFT JOIN departments dept ON dept.id = cr.custodian_department_id
         LEFT JOIN users hod ON hod.id = cr.hod_user_id
        ORDER BY cr.created_at DESC`,
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to fetch issued custodies:', err);
    next(createHttpError(500, 'Failed to load issued custodies'));
  }
};

const actOnCustodyRecord = async (req, res, next) => {
  const { id } = req.params;
  const { decision } = req.body || {};

  const normalizedDecision = String(decision || '').toLowerCase();
  if (!['approved', 'approve', 'rejected', 'reject'].includes(normalizedDecision)) {
    return next(createHttpError(400, 'Decision must be approved or rejected'));
  }

  const finalDecision = ['approved', 'approve'].includes(normalizedDecision)
    ? 'Approved'
    : 'Rejected';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM custody_records WHERE id = $1 FOR UPDATE`,
      [id],
    );

    if (rows.length === 0) {
      throw createHttpError(404, 'Custody record not found');
    }

    const record = rows[0];
    const actingUserId = req.user.id;

    let actorRole = null;
    if (record.custodian_user_id === actingUserId && record.user_approval_status === 'Pending') {
      actorRole = 'custodian';
    } else if (record.hod_user_id === actingUserId && record.hod_approval_status === 'Pending') {
      actorRole = 'hod';
    }

    if (!actorRole) {
      throw createHttpError(403, 'You are not authorized to act on this custody record');
    }

    let userStatus = record.user_approval_status;
    let hodStatus = record.hod_approval_status;

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (actorRole === 'custodian') {
      userStatus = finalDecision;
      setClauses.push(`user_approval_status = $${paramIndex++}`);
      values.push(finalDecision);
      setClauses.push('user_approved_at = NOW()');
    }

    if (actorRole === 'hod') {
      hodStatus = finalDecision;
      setClauses.push(`hod_approval_status = $${paramIndex++}`);
      values.push(finalDecision);
      setClauses.push('hod_approved_at = NOW()');
    }

    const overallStatus =
      finalDecision === 'Rejected'
        ? 'Rejected'
        : computeOverallStatus(userStatus, hodStatus);

    setClauses.push(`status = $${paramIndex++}`);
    values.push(overallStatus);

    setClauses.push('updated_at = NOW()');

    values.push(id);

    await client.query(
      `UPDATE custody_records
          SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}`,
      values,
    );

    await client.query('COMMIT');

    const updated = await fetchCustodyRecordById(client, id);
    res.json({
      message: `Custody record ${finalDecision.toLowerCase()} successfully`,
      record: updated,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to update custody record:', err);
    next(err.statusCode ? err : createHttpError(500, 'Failed to update custody record'));
  } finally {
    client.release();
  }
};

const searchCustodyRecipients = async (req, res, next) => {
  try {
    ensureWarehouseRole(req);
  } catch (err) {
    return next(err);
  }

  const { query } = req.query;
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) {
    return res.json([]);
  }

  try {
    const searchTerm = `%${trimmed.toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT u.id,
              u.name,
              u.email,
              u.department_id,
              d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.is_active = TRUE
          AND (LOWER(u.name) LIKE $1 OR LOWER(u.email) LIKE $1)
        ORDER BY u.name ASC
        LIMIT 20`,
      [searchTerm],
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to search custody recipients:', err);
    next(createHttpError(500, 'Failed to search recipients'));
  }
};

module.exports = {
  createCustodyRecord,
  getPendingCustodyApprovals,
  listIssuedCustodies,
  actOnCustodyRecord,
  searchCustodyRecipients,
};