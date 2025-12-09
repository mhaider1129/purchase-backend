const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { sendEmail } = require('../utils/emailService');
const ensureItemRecallsTable = require('../utils/ensureItemRecallsTable');

const sanitizeString = value => (typeof value === 'string' ? value.trim() : '');

const parsePositiveInteger = value => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NaN;
  }

  return Math.floor(parsed);
};

const canViewRecalls = user =>
  Boolean(user?.hasPermission && user.hasPermission('recalls.view'));

const isProcurementUser = user =>
  Boolean(
    user?.hasAnyPermission &&
      user.hasAnyPermission(['procurement.update-status', 'requests.manage', 'recalls.manage'])
  );

const isWarehouseUser = user =>
  Boolean(
    user?.hasAnyPermission &&
      user.hasAnyPermission(['warehouse.manage-supply', 'stock-requests.create', 'recalls.manage'])
  );

const selectVisibleRecallsQuery = `
  SELECT
    ir.id,
    ir.item_id,
    ir.item_name,
    ir.lot_number,
    ir.quantity,
    ir.reason,
    ir.notes,
    ir.recall_notice,
    ir.supplier_letters,
    ir.ncr_reference,
    ir.capa_reference,
    ir.final_report,
    ir.recall_type,
    ir.status,
    ir.department_id,
    ir.initiated_by_user_id,
    ir.escalated_to_procurement,
    ir.escalated_at,
    ir.escalated_by_user_id,
    ir.warehouse_notes,
    ir.quarantine_active,
    ir.quarantine_reason,
    ir.quarantine_started_at,
    ir.created_at,
    ir.updated_at,
    d.name AS department_name
  FROM item_recalls ir
  LEFT JOIN departments d ON ir.department_id = d.id
`;

const procurementNotificationRoles = [
  'ProcurementSpecialist',
  'SCM',
];

const blockingStatuses = [
  'pending warehouse review',
  'pending procurement action',
  'quarantined - block issuance',
];

const loadProcurementRecipients = async client => {
  const runner = client || pool;
  const procurementUsers = await runner.query(
    `SELECT email, name
       FROM users
      WHERE role = ANY($1)
        AND is_active = TRUE
        AND email IS NOT NULL`,
    [procurementNotificationRoles],
  );

  return procurementUsers.rows.map(row => row.email).filter(Boolean);
};

const fetchStockItemName = async itemId => {
  const { rows } = await pool.query(
    `SELECT name FROM stock_items WHERE id = $1`,
    [itemId],
  );

  if (rows.length === 0) {
    return null;
  }

  return rows[0].name;
};

const listVisibleRecalls = async (req, res, next) => {
  await ensureItemRecallsTable();

  if (!canViewRecalls(req.user)) {
    return next(createHttpError(403, 'Not authorized to view recall requests'));
  }

  let queryText = `${selectVisibleRecallsQuery} ORDER BY ir.id DESC`;
  let params = [];

  if (isProcurementUser(req.user)) {
    params = ['warehouse_to_procurement'];
    queryText = `${selectVisibleRecallsQuery} WHERE ir.recall_type = $1 OR ir.escalated_to_procurement = TRUE ORDER BY ir.id DESC`;
  } else {
    params = [['department_to_warehouse', 'warehouse_to_procurement']];
    queryText = `${selectVisibleRecallsQuery} WHERE ir.recall_type = ANY($1) ORDER BY ir.id DESC`;
  }

  try {
    const { rows } = await pool.query(queryText, params);
    res.json({ recalls: rows });
  } catch (err) {
    console.error('❌ Failed to fetch visible recall requests:', err);
    next(createHttpError(500, 'Failed to load recall requests'));
  }
};

const createDepartmentRecallRequest = async (req, res, next) => {
  await ensureItemRecallsTable();

  const { id: userId, department_id: departmentId } = req.user || {};
  const {
    item_id: rawItemId,
    item_name: rawItemName,
    lot_number: rawLotNumber,
    quantity: rawQuantity,
    reason: rawReason,
    notes: rawNotes,
    recall_notice: rawRecallNotice,
    supplier_letters: rawSupplierLetters,
    ncr_reference: rawNcrReference,
    capa_reference: rawCapaReference,
    final_report: rawFinalReport,
  } = req.body || {};

  if (!departmentId) {
    return next(createHttpError(400, 'User is not linked to a department'));
  }

  const reason = sanitizeString(rawReason);
  if (!reason) {
    return next(createHttpError(400, 'A reason for the recall is required'));
  }

  const notes = sanitizeString(rawNotes);
  const recallNotice = sanitizeString(rawRecallNotice);
  const supplierLetters = sanitizeString(rawSupplierLetters);
  const ncrReference = sanitizeString(rawNcrReference);
  const capaReference = sanitizeString(rawCapaReference);
  const finalReport = sanitizeString(rawFinalReport);

  let itemId = null;
  if (rawItemId !== undefined && rawItemId !== null && String(rawItemId).trim() !== '') {
    const parsed = Number(rawItemId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return next(createHttpError(400, 'Invalid stock item reference'));
    }
    itemId = parsed;
  }

  let itemName = sanitizeString(rawItemName);
  try {
    if (itemId !== null) {
      const fetchedName = await fetchStockItemName(itemId);
      if (fetchedName) {
        itemName = fetchedName;
      } else {
        console.warn(
          '⚠️ Stock item not found during recall request; falling back to provided name',
          { itemId },
        );
        itemId = null;
      }
    }
  } catch (err) {
    if (err.statusCode) {
      return next(err);
    }
    console.error('❌ Failed to validate stock item for recall request:', err);
    return next(createHttpError(500, 'Unable to validate stock item'));
  }

  if (!itemName) {
    return next(createHttpError(400, 'Item name is required for a recall request'));
  }

  const quantity = parsePositiveInteger(rawQuantity);
  if (Number.isNaN(quantity)) {
    return next(createHttpError(400, 'Quantity must be a positive number if provided'));
  }

  const lotNumber = sanitizeString(rawLotNumber);

  try {
    const { rows } = await pool.query(
      `INSERT INTO item_recalls (
        item_id,
        item_name,
        lot_number,
        quantity,
        reason,
        notes,
        recall_notice,
        supplier_letters,
        ncr_reference,
        capa_reference,
        final_report,
        department_id,
        initiated_by_user_id,
        recall_type,
        status
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        NULLIF($5, ''),
        NULLIF($6, ''),
        NULLIF($7, ''),
        NULLIF($8, ''),
        NULLIF($9, ''),
        NULLIF($10, ''),
        NULLIF($11, ''),
        $12,
        $13,
        'department_to_warehouse',
        'Pending Warehouse Review'
      )
      RETURNING *`,
      [
        itemId,
        itemName,
        lotNumber,
        quantity,
        reason,
        notes,
        recallNotice,
        supplierLetters,
        ncrReference,
        capaReference,
        finalReport,
        departmentId,
        userId,
      ],
    );

    const recall = rows[0];
    res.status(201).json({
      message: 'Recall request submitted to the warehouse',
      recall,
    });
  } catch (err) {
    console.error('❌ Failed to create department recall request:', err);
    next(createHttpError(500, 'Failed to submit recall request'));
  }
};

const createWarehouseRecallRequest = async (req, res, next) => {
  await ensureItemRecallsTable();

  const { id: userId, department_id: departmentId } = req.user || {};

  if (!isWarehouseUser(req.user)) {
    return next(createHttpError(403, 'Only warehouse staff can initiate procurement recalls'));
  }

  if (!req.user.hasPermission('recalls.manage')) {
    return next(createHttpError(403, 'You do not have permission to initiate warehouse recalls'));
  }

  if (!departmentId) {
    return next(createHttpError(400, 'Warehouse user is not linked to a department'));
  }

  const {
    item_id: rawItemId,
    item_name: rawItemName,
    lot_number: rawLotNumber,
    quantity: rawQuantity,
    reason: rawReason,
    notes: rawNotes,
    warehouse_notes: rawWarehouseNotes,
    warehouseNotes: rawWarehouseNotesAlt,
    recall_notice: rawRecallNotice,
    supplier_letters: rawSupplierLetters,
    ncr_reference: rawNcrReference,
    capa_reference: rawCapaReference,
    final_report: rawFinalReport,
  } = req.body || {};

  const reason = sanitizeString(rawReason);
  if (!reason) {
    return next(createHttpError(400, 'A reason for the recall is required'));
  }

  const notes = sanitizeString(rawNotes);
  const warehouseNotes = sanitizeString(
    rawWarehouseNotes !== undefined ? rawWarehouseNotes : rawWarehouseNotesAlt,
  );
  const recallNotice = sanitizeString(rawRecallNotice);
  const supplierLetters = sanitizeString(rawSupplierLetters);
  const ncrReference = sanitizeString(rawNcrReference);
  const capaReference = sanitizeString(rawCapaReference);
  const finalReport = sanitizeString(rawFinalReport);

  let itemId = null;
  if (rawItemId !== undefined && rawItemId !== null && String(rawItemId).trim() !== '') {
    const parsed = Number(rawItemId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return next(createHttpError(400, 'Invalid stock item reference'));
    }
    itemId = parsed;
  }

  let itemName = sanitizeString(rawItemName);
  try {
    if (itemId !== null) {
      const fetchedName = await fetchStockItemName(itemId);
      if (fetchedName) {
        itemName = fetchedName;
      } else {
        console.warn(
          '⚠️ Stock item not found during warehouse recall; falling back to provided name',
          { itemId },
        );
        itemId = null;
      }
    }
  } catch (err) {
    if (err.statusCode) {
      return next(err);
    }
    console.error('❌ Failed to validate stock item for procurement recall:', err);
    return next(createHttpError(500, 'Unable to validate stock item'));
  }

  if (!itemName) {
    return next(createHttpError(400, 'Item name is required for a recall request'));
  }

  const quantity = parsePositiveInteger(rawQuantity);
  if (Number.isNaN(quantity)) {
    return next(createHttpError(400, 'Quantity must be a positive number if provided'));
  }

  const lotNumber = sanitizeString(rawLotNumber);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertResult = await client.query(
      `INSERT INTO item_recalls (
        item_id,
        item_name,
        lot_number,
        quantity,
        reason,
        notes,
        recall_notice,
        supplier_letters,
        ncr_reference,
        capa_reference,
        final_report,
        department_id,
        initiated_by_user_id,
        recall_type,
        status,
        escalated_to_procurement,
        escalated_at,
        escalated_by_user_id,
        warehouse_notes,
        quarantine_active,
        quarantine_reason,
        quarantine_started_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        NULLIF($5, ''),
        NULLIF($6, ''),
        NULLIF($7, ''),
        NULLIF($8, ''),
        NULLIF($9, ''),
        NULLIF($10, ''),
        NULLIF($11, ''),
        $12,
        $13,
        'warehouse_to_procurement',
        'Quarantined - Block Issuance',
        TRUE,
        CURRENT_TIMESTAMP,
        $13,
        NULLIF($14, ''),
        TRUE,
        NULLIF($15, ''),
        CURRENT_TIMESTAMP
      )
      RETURNING *`,
      [
        itemId,
        itemName,
        lotNumber,
        quantity,
        reason,
        notes,
        recallNotice,
        supplierLetters,
        ncrReference,
        capaReference,
        finalReport,
        departmentId,
        userId,
        warehouseNotes,
        reason,
      ],
    );

    const recall = insertResult.rows[0];

    const recipients = await loadProcurementRecipients(client);

    await client.query('COMMIT');

    if (recipients.length > 0) {
      const messageLines = [
        `A warehouse recall has been initiated for ${recall.item_name}.`,
        '',
        `Reason: ${recall.reason}`,
      ];

      if (recall.quantity) {
        messageLines.push(`Quantity affected: ${recall.quantity}`);
      }
      if (recall.notes) {
        messageLines.push('', `Notes: ${recall.notes}`);
      }
      if (warehouseNotes) {
        messageLines.push('', `Warehouse notes: ${warehouseNotes}`);
      }

      try {
        await sendEmail(
          recipients,
          'Warehouse recall requires supplier action',
          messageLines.join('\n'),
        );
      } catch (emailErr) {
        console.error('⚠️ Failed to send warehouse recall notification:', emailErr);
      }
    }

    res.status(201).json({
      message: 'Recall escalated to procurement',
      recall,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to create warehouse recall request:', err);
    next(createHttpError(500, 'Failed to escalate recall to procurement'));
  } finally {
    client.release();
  }
};

const escalateRecallToProcurement = async (req, res, next) => {
  const recallId = Number(req.params.id);
  if (!Number.isInteger(recallId) || recallId <= 0) {
    return next(createHttpError(400, 'Invalid recall identifier'));
  }

  await ensureItemRecallsTable();

  const { id: userId } = req.user || {};
  if (!isWarehouseUser(req.user)) {
    return next(createHttpError(403, 'Only warehouse staff can escalate recalls'));
  }

  if (!req.user.hasPermission('recalls.manage')) {
    return next(createHttpError(403, 'You do not have permission to escalate recalls'));
  }

  const warehouseNotes = sanitizeString(req.body?.warehouse_notes ?? req.body?.notes);

  try {
    const existingRes = await pool.query(
      `SELECT id, escalated_to_procurement FROM item_recalls WHERE id = $1`,
      [recallId],
    );

    if (existingRes.rowCount === 0) {
      return next(createHttpError(404, 'Recall request not found'));
    }

    const existing = existingRes.rows[0];
    if (existing.escalated_to_procurement) {
      return next(createHttpError(400, 'Recall has already been escalated to procurement'));
    }

    const { rows } = await pool.query(
      `UPDATE item_recalls
          SET status = 'Pending Procurement Action',
              escalated_to_procurement = TRUE,
              escalated_at = CURRENT_TIMESTAMP,
              escalated_by_user_id = $2,
              warehouse_notes = COALESCE(NULLIF($3, ''), warehouse_notes),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [recallId, userId, warehouseNotes],
    );

    const recall = rows[0];

    const recipients = await loadProcurementRecipients();
    if (recipients.length > 0) {
      const messageLines = [
        `A department recall has been escalated for ${recall.item_name}.`,
        '',
        `Reason: ${recall.reason}`,
      ];

      if (recall.quantity) {
        messageLines.push(`Quantity affected: ${recall.quantity}`);
      }
      if (warehouseNotes) {
        messageLines.push('', `Warehouse notes: ${warehouseNotes}`);
      }

      try {
        await sendEmail(
          recipients,
          'Escalated recall requires supplier follow-up',
          messageLines.join('\n'),
        );
      } catch (emailErr) {
        console.error('⚠️ Failed to send escalated recall notification:', emailErr);
      }
    }

    res.json({
      message: 'Recall escalated to procurement',
      recall,
    });
  } catch (err) {
    console.error('❌ Failed to escalate recall to procurement:', err);
    next(createHttpError(500, 'Failed to escalate recall to procurement'));
  }
};

const quarantineRecall = async (req, res, next) => {
  const recallId = Number(req.params.id);
  if (!Number.isInteger(recallId) || recallId <= 0) {
    return next(createHttpError(400, 'Invalid recall identifier'));
  }

  if (!isWarehouseUser(req.user) && !isProcurementUser(req.user)) {
    return next(createHttpError(403, 'You do not have permission to quarantine recalls'));
  }

  if (!req.user?.hasPermission || !req.user.hasPermission('recalls.manage')) {
    return next(createHttpError(403, 'You do not have permission to quarantine recalls'));
  }

  const { quarantine_reason: rawReason, lot_number: rawLotNumber } = req.body || {};
  const quarantineReason = sanitizeString(rawReason) || 'Lot quarantined pending supplier corrective action.';
  const lotNumber = sanitizeString(rawLotNumber);

  await ensureItemRecallsTable();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingRes = await client.query(
      `SELECT id, item_name, lot_number, quarantine_active, status
         FROM item_recalls
        WHERE id = $1
        FOR UPDATE`,
      [recallId],
    );

    if (existingRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(404, 'Recall request not found'));
    }

    const existing = existingRes.rows[0];

    if (existing.quarantine_active && blockingStatuses.includes(existing.status?.toLowerCase?.())) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'Recall is already quarantined'));
    }

    const { rows } = await client.query(
      `UPDATE item_recalls
          SET status = 'Quarantined - Block Issuance',
              quarantine_active = TRUE,
              quarantine_reason = NULLIF($2, ''),
              lot_number = COALESCE(NULLIF($3, ''), lot_number),
              quarantine_started_at = COALESCE(quarantine_started_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [recallId, quarantineReason, lotNumber],
    );

    const recall = rows[0];

    const recipients = await loadProcurementRecipients(client);
    await client.query('COMMIT');

    if (recipients.length > 0) {
      const detailLines = [
        `Lot ${recall.lot_number || 'unspecified'} for ${recall.item_name} has been quarantined.`,
        '',
        `Reason: ${quarantineReason}`,
        '',
        'Please coordinate supplier corrective actions and confirm replacement stock before lifting the quarantine.',
      ];

      try {
        await sendEmail(
          recipients,
          'Quarantine initiated - supplier corrective action required',
          detailLines.join('\n'),
        );
      } catch (emailErr) {
        console.error('⚠️ Failed to send quarantine notification:', emailErr);
      }
    }

    res.json({
      message: 'Recall quarantined and issuance blocked for the flagged lot',
      recall,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to quarantine recall:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to quarantine recall'));
  } finally {
    client.release();
  }
};

module.exports = {
  listVisibleRecalls,
  createDepartmentRecallRequest,
  createWarehouseRecallRequest,
  escalateRecallToProcurement,
  quarantineRecall,
};