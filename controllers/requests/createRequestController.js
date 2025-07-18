const pool = require('../../config/db');
const { sendEmail } = require('../../utils/emailService');

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const APPROVAL_CHAINS = {
  'Stock-Medical-0-5000': ['HOD', 'CMO', 'SCM'],
  'Stock-Medical-5001-999999999': ['HOD', 'CMO', 'SCM', 'CFO'],
  'Stock-Operational-0-999999999': ['HOD', 'SCM', 'COO'],
  'Non-Stock-Medical-0-999999999': ['HOD', 'WarehouseManager', 'CMO', 'SCM', 'COO'],
  'Non-Stock-Operational-0-10000': ['HOD', 'WarehouseManager', 'SCM', 'COO'],
  'Non-Stock-Operational-10001-999999999': ['HOD', 'WarehouseManager', 'SCM', 'COO', 'CFO'],
  'Medical Device-Medical-0-999999999': ['HOD', 'MedicalDevices', 'CMO', 'SCM', 'COO'],
  'IT Item-Medical-0-999999999': ['HOD', 'SCM', 'COO'],
  'IT Item-Operational-0-999999999': ['HOD', 'SCM', 'COO'],
};

const assignApprover = async (
  client,
  role,
  departmentId,
  requestId,
  requestType,
  level,
) => {
  const globalRoles = ['CMO', 'COO', 'SCM', 'CEO'];
  const query = globalRoles.includes(role.toUpperCase())
    ? `SELECT id, email FROM users WHERE role = $1 AND is_active = true LIMIT 1`
    : `SELECT id, email FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`;
  const values = globalRoles.includes(role.toUpperCase()) ? [role] : [role, departmentId];
  const result = await client.query(query, values);

  const approverId = result.rows[0]?.id || null;
  const approverEmail = result.rows[0]?.email || null;

  await client.query(
    `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      requestId,
      approverId,
      level,
      approverId ? level === 1 : false,
      approverId ? 'Pending' : 'Approved',
      approverId ? null : new Date(),
    ],
  );

  if (approverId && level === 1 && approverEmail) {
    await sendEmail(
      approverEmail,
      'New Purchase Request Awaiting Approval',
      `You have a new ${requestType} request to review.\nRequest ID: ${requestId}\nPlease log in to the system to take action.`,
    );
  }
};

const createRequest = async (req, res, next) => {
  let { request_type, justification, budget_impact_month, items } = req.body;

  // Items may arrive as a JSON string when using multipart/form-data
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (err) {
      return next(createHttpError(400, 'Invalid items payload'));
    }
  }
  
  if (!Array.isArray(items)) return next(createHttpError(400, 'Items must be an array'));
  if (!req.user?.id || !req.user?.department_id) return next(createHttpError(400, 'Invalid user context'));

  if (request_type === 'Stock' && !['warehouse_keeper', 'warehouse_manager'].includes(req.user.role)) {
    return next(createHttpError(403, 'Only warehouse staff can submit stock requests'));
  }

  const requester_id = req.user.id;
  const department_id = req.body.target_department_id || req.user.department_id;
  const section_id = req.body.target_section_id || req.user.section_id || null;

  let maintenance_ref_number = null;
  let initiated_by_technician_id = null;

  if (request_type === 'Maintenance') {
    if (!req.user.role.toLowerCase().includes('technician')) {
      return next(createHttpError(403, 'Only technicians can submit maintenance requests'));
    }
    maintenance_ref_number = req.body.maintenance_ref_number || null;
    initiated_by_technician_id = req.user.id;
  }

  const itemNames = items.map((i) => i.item_name.toLowerCase());
  let duplicateFound = false;
  try {
    const dupRes = await pool.query(
      `SELECT 1
       FROM requests r
       JOIN requested_items ri ON r.id = ri.request_id
       WHERE r.department_id = $1
         AND r.request_type = $3
         AND DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', CURRENT_DATE)
         AND LOWER(ri.item_name) = ANY($2::text[])
       LIMIT 1`,
      [department_id, itemNames, request_type],
    );
    duplicateFound = dupRes.rowCount > 0;

  } catch (err) {
    console.error('❌ Error checking duplicates:', err);
    return next(createHttpError(500, 'Failed to validate duplicate requests'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let estimatedCost = 0;
    if (request_type !== 'Stock') {
      estimatedCost = items.reduce((sum, item) => {
        const qty = parseInt(item.quantity) || 0;
        const unitCost = parseInt(item.unit_cost) || 0;
        return sum + qty * unitCost;
      }, 0);
    }

    const deptRes = await client.query('SELECT type FROM departments WHERE id = $1', [department_id]);
    const deptType = deptRes.rows[0]?.type?.toLowerCase();
    const requestDomain = deptType === 'medical' ? 'medical' : 'operational';

    const requestRes = await client.query(
      `INSERT INTO requests (
        request_type, requester_id, department_id, section_id, justification,
        budget_impact_month, estimated_cost, request_domain,
        maintenance_ref_number, initiated_by_technician_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        request_type,
        requester_id,
        department_id,
        section_id,
        justification,
        budget_impact_month,
        estimatedCost,
        requestDomain,
        maintenance_ref_number,
        initiated_by_technician_id,
      ],
    );

    const request = requestRes.rows[0];
    if (!request?.id) throw createHttpError(500, '❌ Failed to retrieve request ID after insertion');

    const itemIdMap = [];
    for (let idx = 0; idx < items.length; idx++) {
      const { item_name, quantity, unit_cost, available_quantity, intended_use } = items[idx];
      const total_cost = (parseInt(quantity) || 0) * (parseInt(unit_cost) || 0);

      const inserted = await client.query(
        `INSERT INTO requested_items (
          request_id, item_name, quantity, unit_cost, total_cost, available_quantity, intended_use
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          request.id,
          item_name,
          quantity,
          unit_cost,
          total_cost,
          available_quantity || null,
          intended_use || null,
        ],
      );
      itemIdMap[idx] = inserted.rows[0].id;
    }

    if (request_type === 'Maintenance') {
      const designatedRequesterRes = await client.query(
        `SELECT id FROM users
         WHERE role = 'requester'
           AND department_id = $1
           AND ($2::int IS NULL OR section_id = $2)
           AND is_active = true
         LIMIT 1`,
        [department_id, section_id],
      );
      const designatedRequesterId = designatedRequesterRes.rows[0]?.id;
      if (!designatedRequesterId) throw createHttpError(400, 'No designated requester found for this section');

      await client.query(
        `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status)
        VALUES ($1, $2, 1, true, 'Pending')`,
        [request.id, designatedRequesterId],
      );
    } else {
      const capitalize = (s = '') => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

      let costKey;
      if (request_type === 'Stock' && deptType === 'medical') {
        costKey = estimatedCost <= 5000 ? '0-5000' : '5001-999999999';
      } else if (request_type === 'Stock') {
        costKey = '0-999999999';
      } else if (request_type === 'Non-Stock' && deptType === 'medical') {
        costKey = '0-999999999';
      } else if (request_type === 'Non-Stock') {
        costKey = estimatedCost <= 10000 ? '0-10000' : '10001-999999999';
      } else if (request_type === 'Medical Device') {
        costKey = '0-999999999';
      } else if (request_type === 'IT Item') {
        costKey = '0-999999999';
      } else {
        throw createHttpError(400, `Unhandled request_type: ${request_type}`);
      }

      const chainKey = `${request_type}-${capitalize(deptType)}-${costKey}`;
      const approvalRoles = APPROVAL_CHAINS[chainKey];
      if (!approvalRoles) throw createHttpError(400, `No approval chain found for ${chainKey}`);

      for (let i = 0; i < approvalRoles.length; i++) {
        const role = approvalRoles[i];

        if (role === req.user.role && i === 0) {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
             VALUES ($1, $2, $3, false, 'Approved', CURRENT_TIMESTAMP)`,
            [request.id, requester_id, i + 1],
          );
        } else {
          await assignApprover(
            client,
            role,
            department_id,
            request.id,
            request_type,
            i + 1,
          );
        }
      }
    }

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Created', $2, $3)`,
      [request.id, requester_id, justification],
    );

    if (Array.isArray(req.files) && req.files.length > 0) {
      const requestFiles = [];
      const itemFiles = {};

      for (const file of req.files) {
        if (file.fieldname === 'attachments') {
          requestFiles.push(file);
        } else if (file.fieldname.startsWith('item_')) {
          const idx = parseInt(file.fieldname.split('_')[1], 10);
          if (!Number.isNaN(idx)) {
            itemFiles[idx] = itemFiles[idx] || [];
            itemFiles[idx].push(file);
          }
        }
      }

      for (const file of requestFiles) {
        await client.query(
          `INSERT INTO attachments (request_id, item_id, file_name, file_path, uploaded_by)
           VALUES ($1, NULL, $2, $3, $4)`,
          [request.id, file.originalname, file.path, requester_id]
        );
      }

      for (const [idx, files] of Object.entries(itemFiles)) {
        const itemId = itemIdMap[idx];
        if (!itemId) continue;
        for (const file of files) {
          await client.query(
            `INSERT INTO attachments (request_id, item_id, file_name, file_path, uploaded_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [request.id, itemId, file.originalname, file.path, requester_id]
          );
        }
      }
    }

    await client.query('COMMIT');

    if (duplicateFound) {
      try {
        const { rows } = await pool.query(
          `SELECT email FROM users WHERE role IN ('ProcurementSupervisor', 'ProcurementSpecialist', 'SCM') AND is_active = true`
        );
        for (const row of rows) {
          if (row.email) {
            await sendEmail(
              row.email,
              'Duplicate Purchase Request Warning',
              `Request ID ${request.id} may duplicate a submission from this month in department ${department_id}.`
            );
          }
        }
      } catch (notifyErr) {
        console.error('❌ Failed to send duplicate warning emails:', notifyErr);
      }
    }
    
    res.status(201).json({
      message: '✅ Request created successfully with approval routing',
      request_id: request.id,
      estimated_cost: estimatedCost,
      attachments_uploaded: req.files?.length || 0,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating request:', err);
    next(createHttpError(500, 'Failed to create request'));
  } finally {
    client.release();
  }
};

module.exports = { createRequest, assignApprover };