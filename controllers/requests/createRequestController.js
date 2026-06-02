const pool = require("../../config/db");
const { sendEmail } = require("../../utils/emailService");
const { createNotifications } = require("../../utils/notificationService");
const createHttpError = require("../../utils/httpError");
const { fetchApprovalRoutes } = require("../utils/approvalRoutes");
const {
  persistRequestAttachments,
} = require("./saveRequestAttachments");
const ensureWarehouseAssignments = require("../../utils/ensureWarehouseAssignments");
const ensureWarehouseInventoryTables = require("../../utils/ensureWarehouseInventoryTables");
const ensureProjectsTable = require("../../utils/ensureProjectsTable");
const ensureRequestSchedulingColumns = require("../../utils/ensureRequestSchedulingColumns");
const ensureRequestClientSubmissionKey = require("../../utils/ensureRequestClientSubmissionKey");
const { ensureFinanceCoreTables } = require("../../utils/ensureFinanceCoreTables");
const {
  evaluateBudgetCoverage,
  recordCommitment,
} = require("../../services/financeCoreService");

const hasWarehouseAssignment = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
};

const parseOptionalPositiveInteger = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "null" || normalized === "undefined") {
      return null;
    }
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createHttpError(400, `${fieldName} must be a valid ID`);
  }

  return parsed;
};

const assignApprover = async (
  client,
  role,
  departmentId,
  requestId,
  requestType,
  level,
  requestDomain = null,
  preferredWarehouseId = null,
) => {
  const globalRoles = ["CMO", "COO", "SCM", "CEO", "CFO"];
  const normalizedRole = role?.trim().toLowerCase();
  let targetDepartmentId = departmentId;
  let roleToAssign = role;

  if (normalizedRole === "it department hod") {
    roleToAssign = "HOD";
    const itDepartmentRes = await client.query(
      `SELECT d.id
         FROM departments d
         JOIN users u ON u.department_id = d.id
        WHERE LOWER(u.role) = 'hod'
          AND u.is_active = TRUE
          AND (
            LOWER(d.name) = 'it'
            OR LOWER(d.name) = 'information technology'
            OR LOWER(d.name) LIKE 'it %'
            OR LOWER(d.name) LIKE '% information technology%'
          )
        ORDER BY
          CASE
            WHEN LOWER(d.name) = 'it' THEN 0
            WHEN LOWER(d.name) = 'information technology' THEN 1
            ELSE 2
          END,
          d.id
        LIMIT 1`,
    );
    targetDepartmentId = itDepartmentRes.rows[0]?.id || departmentId;
  }

  if (normalizedRole === "maintenance department hod") {
    roleToAssign = "HOD";
    const maintenanceDepartmentRes = await client.query(
      `SELECT d.id
         FROM departments d
         JOIN users u ON u.department_id = d.id
        WHERE LOWER(u.role) = 'hod'
          AND u.is_active = TRUE
          AND (
            LOWER(d.name) = 'maintenance'
            OR LOWER(d.name) LIKE 'maintenance %'
            OR LOWER(d.name) LIKE '% maintenance%'
          )
        ORDER BY
          CASE
            WHEN LOWER(d.name) = 'maintenance' THEN 0
            ELSE 1
          END,
          d.id
        LIMIT 1`,
    );
    targetDepartmentId = maintenanceDepartmentRes.rows[0]?.id || departmentId;
  }

  if (normalizedRole === "warehousemanager") {
    const parsedWarehouseId = Number(preferredWarehouseId);
    if (Number.isInteger(parsedWarehouseId) && parsedWarehouseId > 0) {
      const managerByWarehouseRes = await client.query(
        `SELECT u.department_id
           FROM users u
          WHERE u.is_active = TRUE
            AND LOWER(u.role) = 'warehousemanager'
            AND u.warehouse_id = $1
          ORDER BY u.id
          LIMIT 1`,
        [parsedWarehouseId],
      );
      if (managerByWarehouseRes.rows[0]?.department_id) {
        targetDepartmentId = managerByWarehouseRes.rows[0].department_id;
      }
    }

    const normalizedDomain = requestDomain?.toLowerCase();
    const normalizedRequestType = requestType?.toLowerCase();
    const requiresOperationalWarehouseManager =
      normalizedRequestType === "non-stock" || normalizedRequestType === "maintenance";

    const fallbackDomain = requiresOperationalWarehouseManager ? "operational" : null;
    const domainForManager = requiresOperationalWarehouseManager
      ? "operational"
      : normalizedDomain || fallbackDomain;

    if (domainForManager && !preferredWarehouseId) {
      const managerRes = await client.query(
        `SELECT d.id
           FROM departments d
           JOIN users u ON u.department_id = d.id
          WHERE LOWER(d.type) = $1
            AND LOWER(u.role) = 'warehousemanager'
            AND u.is_active = TRUE
          ORDER BY d.id
          LIMIT 1`,
        [domainForManager],
      );
      targetDepartmentId = managerRes.rows[0]?.id || departmentId;
    }
  }

  const normalizedRoleUpper = roleToAssign?.toUpperCase() || "";
  const isGlobalRole = globalRoles.includes(normalizedRoleUpper);
  const query = isGlobalRole
    ? `SELECT id, email FROM users WHERE role = $1 AND is_active = true LIMIT 1`
    : `SELECT id, email FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`;
  const values = isGlobalRole ? [roleToAssign] : [roleToAssign, targetDepartmentId];
  const result = await client.query(query, values);

  const approverId = result.rows[0]?.id || null;
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
};

const normalizeClientSubmissionKey = (value) => {
  if (value === undefined || value === null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  if (normalized.length > 128) {
    throw createHttpError(400, 'Submission key is too long');
  }

  return normalized;
};

const findExistingRequestBySubmissionKey = async ({ clientSubmissionKey, requesterId }) => {
  if (!clientSubmissionKey || !requesterId) return null;

  const { rows } = await pool.query(
    `SELECT id, request_type, estimated_cost, status, scheduled_for, created_at
       FROM public.requests
      WHERE client_submission_key = $1
        AND requester_id = $2
      ORDER BY id DESC
      LIMIT 1`,
    [clientSubmissionKey, requesterId],
  );

  return rows[0] || null;
};

const isClientSubmissionKeyConflict = (err) => {
  if (err?.code !== '23505') return false;

  const conflictText = [
    err?.constraint,
    err?.detail,
    err?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return conflictText.includes('client_submission_key');
};

const createIdempotentRequestResponse = (request) => ({
  message: 'Request was already submitted; showing the existing request.',
  request_id: request.id,
  request_type: request.request_type,
  estimated_cost: Number(request.estimated_cost) || 0,
  status: request.status,
  scheduled_for: request.scheduled_for || null,
  submitted_at: request.created_at || null,
  duplicate_submission: true,
  attachments_uploaded: 0,
  items: [],
  next_approval: null,
});

const createRequest = async (req, res, next) => {
  let { request_type, justification, items } = req.body;
  let clientSubmissionKey = null;

  try {
    clientSubmissionKey = normalizeClientSubmissionKey(req.body?.client_submission_key);
  } catch (err) {
    return next(err);
  }

  await ensureWarehouseAssignments();
  await ensureProjectsTable();
  await ensureRequestClientSubmissionKey();

  const rawProjectId = req.body?.project_id;
  let projectId = null;
  if (rawProjectId !== undefined && rawProjectId !== null && rawProjectId !== '') {
    const candidate = String(rawProjectId).trim();
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(candidate)) {
      return next(createHttpError(400, 'Invalid project selected'));
    }
    projectId = candidate;
  }

  // Items may arrive as a JSON string when using multipart/form-data
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch (err) {
      return next(createHttpError(400, "Invalid items payload"));
    }
  }

  if (!Array.isArray(items))
    return next(createHttpError(400, "Items must be an array"));

  let supplyWarehouseId = null;
  let supplyWarehouseType = null;
  let scheduledFor = null;

  if (req.body?.scheduled_for !== undefined && req.body?.scheduled_for !== null && req.body?.scheduled_for !== '') {
    const candidateDate = new Date(req.body.scheduled_for);
    if (Number.isNaN(candidateDate.getTime())) {
      return next(createHttpError(400, 'scheduled_for must be a valid date-time'));
    }

    if (candidateDate.getTime() <= Date.now()) {
      return next(createHttpError(400, 'scheduled_for must be in the future'));
    }

    scheduledFor = candidateDate;
  }
  if (request_type === "Warehouse Supply") {
    const candidateWarehouseId =
      req.body?.supply_warehouse_id ?? req.body?.warehouse_id ?? null;

    if (candidateWarehouseId === null || candidateWarehouseId === '') {
      return next(createHttpError(400, "Select the warehouse fulfilling this supply request"));
    }

    supplyWarehouseId = Number(candidateWarehouseId);
    if (!Number.isInteger(supplyWarehouseId)) {
      return next(createHttpError(400, "Supply warehouse must be a valid warehouse ID"));
    }

    const warehouseCheck = await pool.query(
      `SELECT id, type FROM warehouses WHERE id = $1`,
      [supplyWarehouseId]
    );

    if (warehouseCheck.rowCount === 0) {
      return next(createHttpError(400, "Selected warehouse does not exist"));
    }

    supplyWarehouseType = warehouseCheck.rows[0]?.type?.toLowerCase?.();
  }

  const sanitizedItems = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] || {};

    if (!item?.item_name || typeof item.item_name !== "string") {
      return next(
        createHttpError(400, `Item ${idx + 1} is missing a valid name`),
      );
    }

    const normalizedItemName = item.item_name.trim();
    if (!normalizedItemName) {
      return next(
        createHttpError(400, `Item ${idx + 1} is missing a valid name`),
      );
    }

    const quantityCandidate = item.quantity;
    const parsedQuantity = Number(
      typeof quantityCandidate === "string"
        ? quantityCandidate.trim()
        : quantityCandidate,
    );

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return next(
        createHttpError(
          400,
          `Item ${idx + 1} has an invalid quantity; provide a positive number`,
        ),
      );
    }

    if (!Number.isInteger(parsedQuantity)) {
      return next(
        createHttpError(
          400,
          `Item ${idx + 1} quantity must be a whole number without decimals`,
        ),
      );
    }

    const unitCostCandidate = item.unit_cost;
    let parsedUnitCost = null;
    const hasUnitCost =
      unitCostCandidate !== undefined && unitCostCandidate !== null;

    if (hasUnitCost) {
      const normalizedUnitCost =
        typeof unitCostCandidate === "string"
          ? unitCostCandidate.trim()
          : unitCostCandidate;

      if (normalizedUnitCost !== "" && normalizedUnitCost !== null) {
        const numericUnitCost = Number(normalizedUnitCost);

        if (!Number.isFinite(numericUnitCost) || numericUnitCost < 0) {
          return next(
            createHttpError(
              400,
              `Item ${idx + 1} has an invalid unit cost; provide a non-negative number`,
            ),
          );
        }

        if (!Number.isInteger(numericUnitCost)) {
          return next(
            createHttpError(
              400,
              `Item ${idx + 1} unit cost must be a whole number without decimals`,
            ),
          );
        }

        parsedUnitCost = numericUnitCost;
      }
    }

    sanitizedItems.push({
      ...item,
      item_name: normalizedItemName,
      quantity: parsedQuantity,
      unit_cost: parsedUnitCost,
      total_cost:
        parsedUnitCost !== null ? parsedQuantity * parsedUnitCost : null,
    });
  }

  items = sanitizedItems;
  if (request_type === "Warehouse Supply") {
    await ensureWarehouseInventoryTables();

    const { rows: warehouseItems } = await pool.query(
      `SELECT stock_item_id, TRIM(LOWER(item_name)) AS normalized_name
         FROM warehouse_stock_levels
        WHERE warehouse_id = $1`,
      [supplyWarehouseId],
    );

    const allowedItems = new Map();
    warehouseItems.forEach((row) => {
      if (row.normalized_name) {
        allowedItems.set(row.normalized_name, row.stock_item_id);
      }
    });

    const missingFromWarehouse = [];
    items = items.map((item) => {
      const normalizedName = item.item_name.toLowerCase();
      const stockItemId = allowedItems.get(normalizedName);

      if (!stockItemId) {
        missingFromWarehouse.push(item.item_name);
      }

      return {
        ...item,
        stock_item_id: stockItemId || item.stock_item_id || null,
      };
    });

    if (missingFromWarehouse.length > 0) {
      return next(
        createHttpError(
          400,
          `The following items are not available in the selected warehouse: ${missingFromWarehouse.join(", ")}`,
        ),
      );
    }
  }

  if (!req.user?.id || !req.user?.department_id)
    return next(createHttpError(400, "Invalid user context"));
  if (!Number.isInteger(req.user?.institute_id)) {
    return next(createHttpError(400, "User is not linked to an institute"));
  }

  if (request_type === "Stock" && !hasWarehouseAssignment(req.user?.warehouse_id)) {
    return next(
      createHttpError(
        403,
        "Only users linked to a warehouse can submit stock requests",
      ),
    );
  }

  if (request_type === "Stock") {
    supplyWarehouseId = Number(req.user.warehouse_id);
  }

  if (request_type === "Medication") {
    if (
      req.user.role.toLowerCase() !== "requester" ||
      !req.user.can_request_medication
    ) {
      return next(
        createHttpError(
          403,
          "You are not authorized to submit medication requests",
        ),
      );
    }
  }

  let requester_id = req.user.id;
  let effectiveRequesterId = requester_id;
  let department_id;
  let section_id;
  try {
    department_id =
      parseOptionalPositiveInteger(req.body.target_department_id, "Target department") ||
      req.user.department_id;
    section_id =
      parseOptionalPositiveInteger(req.body.target_section_id, "Target section") ||
      parseOptionalPositiveInteger(req.user.section_id, "User section");
  } catch (err) {
    return next(err);
  }
  const institute_id = req.user.institute_id;

  let temporaryRequesterName = '';

  let maintenance_ref_number = null;
  let initiated_by_technician_id = null;

  if (request_type === "Maintenance") {
    if (!req.user.role.toLowerCase().includes("technician")) {
      return next(
        createHttpError(
          403,
          "Only technicians can submit maintenance requests",
        ),
      );
    }
    maintenance_ref_number = req.body.maintenance_ref_number || null;
    initiated_by_technician_id = req.user.id;

    const selectedRequesterId = Number.parseInt(req.body.target_requester_id, 10);
    if (!Number.isInteger(selectedRequesterId)) {
      return next(createHttpError(400, "Select a requester for this maintenance request"));
    }

    const requesterFilterValues = [selectedRequesterId, department_id];
    let requesterSectionCondition = '';
    if (section_id) {
      requesterFilterValues.push(section_id);
      requesterSectionCondition = 'AND u.section_id = $3';
    }

    const requesterLookup = await pool.query(
      `SELECT u.id
         FROM users u
        WHERE u.id = $1
          AND u.department_id = $2
          ${requesterSectionCondition}
          AND u.is_active = TRUE
          AND LOWER(TRIM(u.role)) = 'requester'
        LIMIT 1`,
      requesterFilterValues,
    );
    if (requesterLookup.rowCount === 0) {
      return next(createHttpError(400, "Selected requester is invalid for the selected department/section"));
    }
    requester_id = selectedRequesterId;
    effectiveRequesterId = requester_id;
  }

  const itemNames = items.map((i) => i.item_name.toLowerCase());
  let duplicateFound = false;
  try {
    const table =
      request_type === "Warehouse Supply"
        ? "warehouse_supply_items"
        : "public.requested_items";
    const dupRes = await pool.query(
      `SELECT 1
       FROM requests r
       JOIN ${table} ri ON r.id = ri.request_id
       WHERE r.department_id = $1
         AND r.request_type = $3
         AND DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', CURRENT_DATE)
         AND LOWER(ri.item_name) = ANY($2::text[])
         AND ($4::INT IS NULL OR r.supply_warehouse_id = $4)
       LIMIT 1`,
      [department_id, itemNames, request_type, supplyWarehouseId],
    );
    duplicateFound = dupRes.rowCount > 0;

  } catch (err) {
    console.error("❌ Error checking duplicates:", err);
    return next(createHttpError(500, "Failed to validate duplicate requests"));
  }

  const client = await pool.connect();
  try {
    await ensureRequestSchedulingColumns();
    await client.query("BEGIN");

    if (projectId !== null) {
      const projectCheck = await client.query(
        `SELECT id FROM projects WHERE id = $1 AND is_active IS DISTINCT FROM FALSE`,
        [projectId],
      );

      if (projectCheck.rowCount === 0) {
        throw createHttpError(400, 'Selected project was not found or is inactive');
      }
    }

    let estimatedCost = 0;
    if (request_type !== "Stock") {
      estimatedCost = items.reduce((sum, item) => {
        if (item.unit_cost === null || item.unit_cost === undefined) {
          return sum;
        }
        return sum + item.quantity * item.unit_cost;
      }, 0);
    }

    const deptRes = await client.query(
      "SELECT type, institute_id FROM departments WHERE id = $1",
      [department_id],
    );
    const deptType = deptRes.rows[0]?.type?.toLowerCase();
    const departmentInstituteId = deptRes.rows[0]?.institute_id;
    if (Number.isInteger(departmentInstituteId) && departmentInstituteId !== institute_id) {
      await client.query('ROLLBACK');
      return next(createHttpError(403, 'Department is outside your institute'));
    }
    let requestDomain = deptType === "medical" ? "medical" : "operational";

    if (
      request_type === "Warehouse Supply" &&
      ["medical", "operational"].includes(supplyWarehouseType)
    ) {
      requestDomain = supplyWarehouseType;
    }

    const initialStatus = scheduledFor ? 'Scheduled' : 'Submitted';
    const requestRes = await client.query(
      `INSERT INTO requests (
        request_type, requester_id, department_id, institute_id, section_id, justification,
        estimated_cost, request_domain, status,
        maintenance_ref_number, initiated_by_technician_id,
        project_id, temporary_requester_name, supply_warehouse_id, scheduled_for, client_submission_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        request_type,
        requester_id,
        department_id,
        institute_id,
        section_id,
        justification,
        estimatedCost,
        requestDomain,
        initialStatus,
        maintenance_ref_number,
        initiated_by_technician_id,
        projectId,
        request_type === "Maintenance" ? temporaryRequesterName : null,
        supplyWarehouseId,
        scheduledFor,
        clientSubmissionKey,
      ],
    );

    const request = requestRes.rows[0];
    if (!request?.id)
      throw createHttpError(
        500,
        "❌ Failed to retrieve request ID after insertion",
      );

    let budgetCoverage = null;
    if (estimatedCost > 0) {
      await ensureFinanceCoreTables(client);
      budgetCoverage = await evaluateBudgetCoverage(client, {
        departmentId: department_id,
        projectId: projectId || null,
        amount: estimatedCost,
        currency: 'USD',
      });

      if (budgetCoverage.envelope) {
        await recordCommitment(client, {
          requestId: request.id,
          budgetEnvelopeId: budgetCoverage.envelope.id,
          stage: 'reservation',
          amount: estimatedCost,
          currency: 'USD',
          sourceType: 'purchase_request',
          sourceId: String(request.id),
          notes: budgetCoverage.isOverBudget
            ? `Over-budget reservation from purchase request ${request.id}`
            : `Budget reservation from purchase request ${request.id}`,
          actorId: req.user.id,
        });
      }
    }

    const itemIdMap = [];
    for (let idx = 0; idx < items.length; idx++) {
      const {
        item_name,
        brand,
        quantity,
        unit_cost,
        available_quantity,
        intended_use,
        specs,
      } = items[idx];
      let requestedItemId = null;
      if (request_type !== "Warehouse Supply") {
        let insertedReq;
        if (request_type === "Stock") {
          insertedReq = await client.query(
            `INSERT INTO public.requested_items (
              request_id,
              item_name,
              brand,
              quantity,
              unit_cost,
              total_cost,
              available_quantity,
              intended_use,
              specs
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              request.id,
              item_name,
              brand || null,
              quantity,
              unit_cost,
              unit_cost !== null ? quantity * unit_cost : null,
              available_quantity || null,
              intended_use || null,
              specs || null,
            ],
          );
        } else {
          insertedReq = await client.query(
            `INSERT INTO public.requested_items (
              request_id,
              item_name,
              brand,
              quantity,
              unit_cost,
              total_cost,
              available_quantity,
              intended_use,
              specs
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              request.id,
              item_name,
              brand || null,
              quantity,
              unit_cost,
              unit_cost !== null ? quantity * unit_cost : null,
              available_quantity || null,
              intended_use || null,
              specs || null,
            ],
          );
        }
        requestedItemId = insertedReq.rows[0].id;
        itemIdMap[idx] = requestedItemId;
      }

      if (request_type === "Warehouse Supply") {
        const wsRes = await client.query(
          `INSERT INTO warehouse_supply_items (request_id, item_name, quantity)
           VALUES ($1, $2, $3) RETURNING id`,
          [request.id, item_name, quantity],
        );
        itemIdMap[idx] = wsRes.rows[0].id;
      }
    }

    const domainForChain =
      (request_type === "Warehouse Supply" ? requestDomain : deptType) ||
      requestDomain ||
      "operational";

    let routes = await fetchApprovalRoutes({
      client,
      requestType: request_type,
      departmentType: domainForChain,
      amount: estimatedCost,
    });

    if (!routes.length) {
      console.warn(
        `⚠️ No approval routes configured for ${request_type} - ${domainForChain}. Falling back to SCM approval.`,
      );
      await assignApprover(
        client,
        "SCM",
        department_id,
        request.id,
        request_type,
        1,
        requestDomain,
      );
    } else {
      const requesterRole = req.user.role
        ? req.user.role.trim().toLowerCase()
        : "";

      for (const { role, approval_level } of routes) {
        const normalizedRouteRole = role?.trim().toLowerCase() || "";

        if (normalizedRouteRole === "requester") {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
               VALUES ($1, $2, $3, FALSE, 'Approved', CURRENT_TIMESTAMP)`,
            [request.id, requester_id, approval_level],
          );
          continue;
        }

        if (
          normalizedRouteRole === requesterRole &&
          approval_level === 1
        ) {
          await client.query(
            `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
               VALUES ($1, $2, $3, FALSE, 'Approved', CURRENT_TIMESTAMP)`,
            [request.id, requester_id, approval_level],
          );
          continue;
        }

        await assignApprover(
          client,
          role,
          department_id,
          request.id,
          request_type,
          approval_level,
          requestDomain,
          supplyWarehouseId ?? req.user?.warehouse_id ?? null,
        );
      }
    }

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'Created', $2, $3)`,
      [request.id, requester_id, justification],
    );

    const attachmentsStored = await persistRequestAttachments({
      client,
      requestId: request.id,
      requesterId: requester_id,
      itemIdMap,
      files: req.files,
    });

    if (!scheduledFor) {
      // Ensure the earliest pending approval is active
      await client.query(
        `UPDATE approvals
         SET is_active = TRUE
         WHERE request_id = $1
           AND approval_level = (
             SELECT MIN(approval_level)
             FROM approvals
             WHERE request_id = $1 AND status = 'Pending'
           )`,
        [request.id],
      );
    }

    const { rows: pendingApprovals } = await client.query(
      `SELECT a.approval_level,
              a.approver_id,
              u.name AS approver_name,
              u.role AS approver_role,
              u.email AS approver_email
         FROM approvals a
         LEFT JOIN users u ON u.id = a.approver_id
        WHERE a.request_id = $1
          AND a.status = 'Pending'
          AND a.is_active = TRUE
        ORDER BY a.approval_level ASC, a.id ASC`,
      [request.id],
    );

    let itemStatusPayload = [];
    if (request_type === "Warehouse Supply") {
      const { rows } = await client.query(
        `SELECT id, item_name, quantity
           FROM warehouse_supply_items
          WHERE request_id = $1
          ORDER BY id`,
        [request.id],
      );

      itemStatusPayload = rows.map((row) => ({
        id: row.id,
        item_name: row.item_name,
        quantity: Number(row.quantity) || 0,
        purchased_quantity: 0,
        status: "Not Purchased",
      }));
    } else {
      const { rows } = await client.query(
        `SELECT id, item_name, quantity, COALESCE(purchased_quantity, 0) AS purchased_quantity
           FROM public.requested_items
          WHERE request_id = $1
          ORDER BY id`,
        [request.id],
      );

      itemStatusPayload = rows.map((row) => {
        const quantity = Number(row.quantity) || 0;
        const purchasedQuantity = Number(row.purchased_quantity) || 0;
        const isPurchased = quantity > 0 && purchasedQuantity >= quantity;

        return {
          id: row.id,
          item_name: row.item_name,
          quantity,
          purchased_quantity: purchasedQuantity,
          status: isPurchased ? "Purchased" : "Not Purchased",
        };
      });
    }

    await client.query("COMMIT");

    if (duplicateFound) {
      try {
        const { rows } = await pool.query(
          `SELECT email FROM users WHERE role IN ('ProcurementSpecialist', 'SCM') AND is_active = true`,
        );
        for (const row of rows) {
          if (row.email) {
            await sendEmail(
              row.email,
              "Duplicate Purchase Request Warning",
              `Request ID ${request.id} may duplicate a submission from this month in department ${department_id}.`,
            );
          }
        }
      } catch (notifyErr) {
        console.error("❌ Failed to send duplicate warning emails:", notifyErr);
      }
    }

    const nextApproval = pendingApprovals[0] || null;
    const approversToNotify = scheduledFor
      ? []
      : pendingApprovals.filter((approval) => approval?.approver_id);

    if (approversToNotify.length > 0) {
      const message = `The ${request_type} request with ID ${request.id} is ready for your approval.`;
      try {
        await createNotifications(
          approversToNotify.map((approval) => ({
            userId: approval.approver_id,
            title: 'Purchase Request Awaiting Approval',
            message,
            link: `/requests/${request.id}`,
            metadata: {
              requestId: request.id,
              requestType: request_type,
              action: 'approval_required',
            },
          })),
        );
      } catch (notifyErr) {
        console.error('⚠️ Failed to create notification for next approvers:', notifyErr);
      }

      const uniqueApproverEmails = [...new Set(
        approversToNotify.map((approval) => approval.approver_email).filter(Boolean),
      )];

      for (const approverEmail of uniqueApproverEmails) {
        try {
          await sendEmail(
            approverEmail,
            'New Purchase Request Awaiting Approval',
            `${message}
Please log in to the system to take action.`,
          );
        } catch (emailErr) {
          console.error('⚠️ Failed to email one of the next approvers:', emailErr);
        }
      }
    }

    res.status(201).json({
      message: "✅ Request created successfully with approval routing",
      request_id: request.id,
      request_type,
      estimated_cost: estimatedCost,
      status: initialStatus,
      scheduled_for: request.scheduled_for || null,
      attachments_uploaded: attachmentsStored,
      temporary_requester_name: request.temporary_requester_name || null,
      items: itemStatusPayload,
      next_approval: nextApproval
        ? {
            level: nextApproval.approval_level,
            approver_name: nextApproval.approver_name || null,
            approver_role: nextApproval.approver_role || null,
          }
        : null,
      duplicate_detected: duplicateFound,
      budget_warning: budgetCoverage?.warning || null,
      budget_exceeded: Boolean(budgetCoverage?.isOverBudget),
      budget: budgetCoverage?.snapshot || null,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    if (
      isClientSubmissionKeyConflict(err) &&
      clientSubmissionKey
    ) {
      try {
        const existingRequest = await findExistingRequestBySubmissionKey({
          clientSubmissionKey,
          requesterId: effectiveRequesterId || req.user?.id,
        });

        if (existingRequest) {
          return res.status(200).json(createIdempotentRequestResponse(existingRequest));
        }
      } catch (lookupErr) {
        console.error('❌ Failed to resolve duplicate request submission:', lookupErr);
      }
    }

    console.error("❌ Error creating request:", err);
    if (err?.statusCode) {
      next(err);
    } else {
      next(createHttpError(500, "Failed to create request"));
    }
  } finally {
    client.release();
  }
};

module.exports = { createRequest, assignApprover };
