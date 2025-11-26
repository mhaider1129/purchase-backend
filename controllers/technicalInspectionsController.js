const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const ensureTechnicalInspectionsTable = require('../utils/ensureTechnicalInspectionsTable');
const {
  applyRequestStatusFromInspections,
  getInspectionSummaryForRequest,
} = require('../utils/technicalInspectionStatus');

const CONDITION_OPTIONS = new Set([
  'excellent',
  'good',
  'fair',
  'poor',
  'not_sure',
  'not_applicable',
]);

const DEFAULT_GENERAL_ITEMS = [
  'General condition',
  'Packaging',
  'Labelling/Markings',
];

const DEFAULT_CATEGORY_ITEMS = [
  'Compliance with specifications',
  'Quality',
  'Functionality',
  'Expiry date',
  'Storage requirements',
  'Calibrated',
  'Safety features',
  'Structural integrity',
  'Compatibility with existing system',
  'SDS available',
];

const ACCEPTANCE_STATUSES = new Set(['pending', 'passed', 'failed']);

const sanitizeText = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const normalizeCondition = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  if (CONDITION_OPTIONS.has(normalized)) return normalized;
  if (normalized === 'n/a') return 'not_applicable';
  if (normalized === 'not_applicable') return 'not_applicable';
  return null;
};

const normalizeChecklist = (entries, defaults = []) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return defaults.map((item) => ({
      item,
      condition: null,
      comment: null,
      action_required: null,
    }));
  }

  return entries.map((entry, index) => {
    const sourceItem = entry?.item ?? defaults[index];
    return {
      item: sanitizeText(sourceItem),
      condition: normalizeCondition(entry?.condition),
      comment: sanitizeText(entry?.comment),
      action_required: sanitizeText(entry?.action_required),
    };
  });
};

const normalizeInspectors = (inspectors = []) => {
  if (!Array.isArray(inspectors)) return [];
  return inspectors
    .slice(0, 5)
    .map((inspector) => ({
      name: sanitizeText(inspector?.name),
      title: sanitizeText(inspector?.title),
      contact_information: sanitizeText(inspector?.contact_information),
      department: sanitizeText(inspector?.department),
    }))
    .filter((inspector) => inspector.name || inspector.title || inspector.department);
};

const normalizeSummary = (summary = {}) => {
  if (!summary || typeof summary !== 'object') {
    return {};
  }

  return {
    overall_condition: normalizeCondition(summary.overall_condition),
    immediate_actions: sanitizeText(summary.immediate_actions),
    recommended_actions: sanitizeText(summary.recommended_actions),
    additional_comments: sanitizeText(summary.additional_comments),
  };
};

const normalizeApprovals = (approvals = {}) => {
  if (!approvals || typeof approvals !== 'object') {
    return {};
  }

  const normalizeSignature = (signature) => ({
    name: sanitizeText(signature?.name),
    date: signature?.date ? String(signature.date) : null,
    title: sanitizeText(signature?.title),
  });

  const inspector_signatures = Array.isArray(approvals.inspector_signatures)
    ? approvals.inspector_signatures.slice(0, 5).map(normalizeSignature)
    : [];

  const procurement_supervisor = approvals.procurement_supervisor
    ? normalizeSignature(approvals.procurement_supervisor)
    : null;

  return {
    inspector_signatures: inspector_signatures.filter(
      (signature) => signature.name || signature.date,
    ),
    procurement_supervisor,
  };
};

const normalizeAcceptanceStatus = (value) => {
  if (!value && value !== '') return null;
  const normalized = String(value).trim().toLowerCase();
  return ACCEPTANCE_STATUSES.has(normalized) ? normalized : null;
};

const parseDateOrThrow = (value, fieldName) => {
  if (!value) {
    throw createHttpError(400, `${fieldName} is required`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid date`);
  }
  return parsed.toISOString().slice(0, 10);
};

const resolveRequestLink = async ({ request_id, requested_item_id }) => {
  const parsedRequestId = Number(request_id);
  const parsedRequestedItemId = Number(requested_item_id);

  let resolvedRequestId = Number.isInteger(parsedRequestId) ? parsedRequestId : null;
  let resolvedRequestedItemId = Number.isInteger(parsedRequestedItemId)
    ? parsedRequestedItemId
    : null;

  if (resolvedRequestedItemId) {
    const { rows, rowCount } = await pool.query(
      'SELECT id, request_id FROM requested_items WHERE id = $1',
      [resolvedRequestedItemId],
    );

    if (rowCount === 0) {
      throw createHttpError(404, 'Requested item not found for technical inspection link');
    }

    resolvedRequestId = resolvedRequestId ?? rows[0].request_id ?? null;
  }

  if (resolvedRequestId) {
    const requestCheck = await pool.query('SELECT id FROM requests WHERE id = $1', [
      resolvedRequestId,
    ]);

    if (requestCheck.rowCount === 0) {
      throw createHttpError(404, 'Request not found for technical inspection link');
    }
  }

  return { requestId: resolvedRequestId, requestedItemId: resolvedRequestedItemId };
};

const formatRow = (row) => ({
  ...row,
  general_checklist: Array.isArray(row.general_checklist)
    ? row.general_checklist
    : [],
  category_checklist: Array.isArray(row.category_checklist)
    ? row.category_checklist
    : [],
  summary: row.summary && typeof row.summary === 'object' ? row.summary : {},
  inspectors: Array.isArray(row.inspectors) ? row.inspectors : [],
  approvals: row.approvals && typeof row.approvals === 'object' ? row.approvals : {},
  request_id: row.request_id ?? null,
  requested_item_id: row.requested_item_id ?? null,
  acceptance_status: row.acceptance_status || 'pending',
  acceptance_notes: row.acceptance_notes || null,
  acceptance_recorded_by: row.acceptance_recorded_by ?? null,
  acceptance_recorded_at: row.acceptance_recorded_at || null,
});

const listTechnicalInspections = async (req, res, next) => {
  try {
    await ensureTechnicalInspectionsTable();

    const { search, start_date, end_date, category } = req.query || {};

    const clauses = [];
    const params = [];
    let idx = 1;

    if (search) {
      clauses.push(
        `(LOWER(item_name) LIKE $${idx} OR LOWER(supplier_name) LIKE $${idx} OR LOWER(location) LIKE $${idx})`,
      );
      params.push(`%${String(search).trim().toLowerCase()}%`);
      idx += 1;
    }

    if (category) {
      clauses.push(`LOWER(item_category) = $${idx}`);
      params.push(String(category).trim().toLowerCase());
      idx += 1;
    }

    if (start_date) {
      const parsed = parseDateOrThrow(start_date, 'Start date');
      clauses.push(`inspection_date >= $${idx}`);
      params.push(parsed);
      idx += 1;
    }

    if (end_date) {
      const parsed = parseDateOrThrow(end_date, 'End date');
      clauses.push(`inspection_date <= $${idx}`);
      params.push(parsed);
      idx += 1;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT * FROM technical_inspections ${where} ORDER BY inspection_date DESC, created_at DESC`,
      params,
    );

    res.json(rows.map(formatRow));
  } catch (error) {
    next(error);
  }
};

const getTechnicalInspectionById = async (req, res, next) => {
  try {
    await ensureTechnicalInspectionsTable();

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw createHttpError(400, 'A valid inspection id is required');
    }

    const { rows } = await pool.query(
      'SELECT * FROM technical_inspections WHERE id = $1',
      [id],
    );

    if (rows.length === 0) {
      throw createHttpError(404, 'Inspection not found');
    }

    res.json(formatRow(rows[0]));
  } catch (error) {
    next(error);
  }
};

const createTechnicalInspection = async (req, res, next) => {
  try {
    await ensureTechnicalInspectionsTable();

    const {
      inspection_date,
      location,
      item_name,
      item_category,
      model_number,
      serial_number,
      lot_number,
      manufacturer,
      supplier_name,
      general_checklist,
      category_checklist,
      summary,
      inspectors,
      approvals,
      request_id,
      requested_item_id,
      acceptance_status,
      acceptance_notes,
    } = req.body || {};

    if (!item_name || typeof item_name !== 'string' || !item_name.trim()) {
      throw createHttpError(400, 'Item name is required');
    }

    const parsedDate = parseDateOrThrow(
      inspection_date || new Date().toISOString().slice(0, 10),
      'Inspection date',
    );

    const normalizedGeneral = normalizeChecklist(
      general_checklist,
      DEFAULT_GENERAL_ITEMS,
    );
    const normalizedCategory = normalizeChecklist(
      category_checklist,
      DEFAULT_CATEGORY_ITEMS,
    );

    const normalizedSummary = normalizeSummary(summary);
    const normalizedInspectors = normalizeInspectors(inspectors);
    const normalizedApprovals = normalizeApprovals(approvals);

    const acceptanceStatus = normalizeAcceptanceStatus(acceptance_status) || 'pending';
    const acceptanceRecordedBy =
      acceptanceStatus === 'pending' ? null : req.user?.id ?? null;
    const acceptanceRecordedAt = acceptanceStatus === 'pending' ? null : new Date();
    const acceptanceNotes = sanitizeText(acceptance_notes);

    const { requestId, requestedItemId } = await resolveRequestLink({
      request_id,
      requested_item_id,
    });

    const { rows } = await pool.query(
      `INSERT INTO technical_inspections (
        inspection_date,
        location,
        item_name,
        item_category,
        model_number,
        serial_number,
        lot_number,
        manufacturer,
        supplier_name,
        general_checklist,
        category_checklist,
        summary,
        inspectors,
        approvals,
        created_by,
        created_by_name,
        request_id,
        requested_item_id,
        acceptance_status,
        acceptance_notes,
        acceptance_recorded_by,
        acceptance_recorded_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      ) RETURNING *`,
      [
        parsedDate,
        sanitizeText(location),
        sanitizeText(item_name),
        sanitizeText(item_category),
        sanitizeText(model_number),
        sanitizeText(serial_number),
        sanitizeText(lot_number),
        sanitizeText(manufacturer),
        sanitizeText(supplier_name),
        JSON.stringify(normalizedGeneral),
        JSON.stringify(normalizedCategory),
        JSON.stringify(normalizedSummary),
        JSON.stringify(normalizedInspectors),
        JSON.stringify(normalizedApprovals),
        req.user?.id ?? null,
        req.user?.name ?? null,
        requestId,
        requestedItemId,
        acceptanceStatus,
        acceptanceNotes,
        acceptanceRecordedBy,
        acceptanceRecordedAt,
      ],
    );

    const createdInspection = formatRow(rows[0]);

    if (requestId) {
      await applyRequestStatusFromInspections(pool, {
        requestId,
        actorId: req.user?.id ?? null,
        pendingComment:
          'Procurement marked the request as complete; awaiting technical inspection confirmation.',
        completedComment: 'Technical inspection completed and accepted.',
      });
    }

    res.status(201).json(createdInspection);
  } catch (error) {
    next(error);
  }
};

const updateTechnicalInspection = async (req, res, next) => {
  try {
    await ensureTechnicalInspectionsTable();

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw createHttpError(400, 'A valid inspection id is required');
    }

    const existing = await pool.query(
      `SELECT
        id,
        request_id,
        requested_item_id,
        acceptance_status,
        acceptance_notes,
        acceptance_recorded_by,
        acceptance_recorded_at
       FROM technical_inspections
      WHERE id = $1`,
      [id],
    );

    if (existing.rowCount === 0) {
      throw createHttpError(404, 'Inspection not found');
    }

    const existingRow = existing.rows[0];

    const {
      inspection_date,
      location,
      item_name,
      item_category,
      model_number,
      serial_number,
      lot_number,
      manufacturer,
      supplier_name,
      general_checklist,
      category_checklist,
      summary,
      inspectors,
      approvals,
      request_id,
      requested_item_id,
      acceptance_status,
      acceptance_notes,
    } = req.body || {};

    if (!item_name || typeof item_name !== 'string' || !item_name.trim()) {
      throw createHttpError(400, 'Item name is required');
    }

    const parsedDate = parseDateOrThrow(
      inspection_date || new Date().toISOString().slice(0, 10),
      'Inspection date',
    );

    const normalizedGeneral = normalizeChecklist(
      general_checklist,
      DEFAULT_GENERAL_ITEMS,
    );
    const normalizedCategory = normalizeChecklist(
      category_checklist,
      DEFAULT_CATEGORY_ITEMS,
    );

    const normalizedSummary = normalizeSummary(summary);
    const normalizedInspectors = normalizeInspectors(inspectors);
    const normalizedApprovals = normalizeApprovals(approvals);

    const { requestId, requestedItemId } = await resolveRequestLink({
      request_id: request_id ?? existingRow.request_id,
      requested_item_id: requested_item_id ?? existingRow.requested_item_id,
    });

    const acceptanceStatus =
      normalizeAcceptanceStatus(acceptance_status) || existingRow.acceptance_status || 'pending';

    const acceptanceNotes =
      acceptance_notes !== undefined
        ? sanitizeText(acceptance_notes)
        : existingRow.acceptance_notes || null;

    const acceptanceRecordedBy =
      acceptanceStatus === existingRow.acceptance_status
        ? existingRow.acceptance_recorded_by
        : acceptanceStatus === 'pending'
          ? null
          : req.user?.id ?? null;

    const acceptanceRecordedAt =
      acceptanceStatus === existingRow.acceptance_status
        ? existingRow.acceptance_recorded_at
        : acceptanceStatus === 'pending'
          ? null
          : new Date();

    const { rows } = await pool.query(
      `UPDATE technical_inspections
          SET inspection_date = $1,
              location = $2,
              item_name = $3,
              item_category = $4,
              model_number = $5,
              serial_number = $6,
              lot_number = $7,
              manufacturer = $8,
              supplier_name = $9,
              general_checklist = $10::jsonb,
              category_checklist = $11::jsonb,
              summary = $12::jsonb,
              inspectors = $13::jsonb,
              approvals = $14::jsonb,
              request_id = $15,
              requested_item_id = $16,
              acceptance_status = $17,
              acceptance_notes = $18,
              acceptance_recorded_by = $19,
              acceptance_recorded_at = $20,
              updated_at = NOW()
        WHERE id = $21
      RETURNING *`,
      [
        parsedDate,
        sanitizeText(location),
        sanitizeText(item_name),
        sanitizeText(item_category),
        sanitizeText(model_number),
        sanitizeText(serial_number),
        sanitizeText(lot_number),
        sanitizeText(manufacturer),
        sanitizeText(supplier_name),
        JSON.stringify(normalizedGeneral),
        JSON.stringify(normalizedCategory),
        JSON.stringify(normalizedSummary),
        JSON.stringify(normalizedInspectors),
        JSON.stringify(normalizedApprovals),
        requestId,
        requestedItemId,
        acceptanceStatus,
        acceptanceNotes,
        acceptanceRecordedBy,
        acceptanceRecordedAt,
        id,
      ],
    );

    const updatedRow = formatRow(rows[0]);

    if (requestId) {
      await applyRequestStatusFromInspections(pool, {
        requestId,
        actorId: req.user?.id ?? null,
        pendingComment: 'Technical inspection recorded but pending acceptance.',
        completedComment: 'Technical inspection updated and accepted.',
      });
    }

    res.json(updatedRow);
  } catch (error) {
    next(error);
  }
};

const deleteTechnicalInspection = async (req, res, next) => {
  try {
    await ensureTechnicalInspectionsTable();

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      throw createHttpError(400, 'A valid inspection id is required');
    }

    const { rowCount } = await pool.query(
      'DELETE FROM technical_inspections WHERE id = $1',
      [id],
    );

    if (rowCount === 0) {
      throw createHttpError(404, 'Inspection not found');
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listTechnicalInspections,
  getTechnicalInspectionById,
  createTechnicalInspection,
  updateTechnicalInspection,
  deleteTechnicalInspection,
};