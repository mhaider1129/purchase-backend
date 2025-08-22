const pool = require("../../config/db");
const { sendEmail } = require("../../utils/emailService");
const createHttpError = require("../../utils/httpError");

/**
 * Fetch approval routing configuration from the database.
 * Returns an array of objects: { approval_level, role }
 */
const fetchApprovalRoutes = async (
  client,
  requestType,
  departmentType,
  cost,
) => {
  const { rows } = await client.query(
    `SELECT approval_level, role
       FROM approval_routes
      WHERE request_type = $1
        AND department_type = $2
        AND $3 BETWEEN COALESCE(min_amount, 0) AND COALESCE(max_amount, 999999999)
      ORDER BY approval_level`,
    [requestType, departmentType, cost],
  );
  return rows;
};

const assignApprover = async (
  client,
  role,
  departmentId,
  requestId,
  requestType,
  level,
  requestDomain = null,
) => {
  const globalRoles = ["CMO", "COO", "SCM", "CEO"];
  let targetDepartmentId = departmentId;

  if (role === "WarehouseManager" && requestType === "Non-Stock") {
    const opRes = await client.query(
      `SELECT d.id
       FROM departments d
       JOIN users u ON u.department_id = d.id
       WHERE LOWER(d.type) = 'operational'
         AND u.role = 'WarehouseManager'
         AND u.is_active = true
       ORDER BY d.id LIMIT 1`,
    );
    targetDepartmentId = opRes.rows[0]?.id || departmentId;
  }

  if (
    role === "WarehouseManager" &&
    requestType === "Warehouse Supply" &&
    requestDomain
  ) {
    const wsRes = await client.query(
      `SELECT d.id
         FROM departments d
         JOIN users u ON u.department_id = d.id
        WHERE LOWER(d.type) = $1
          AND u.role = 'WarehouseManager'
          AND u.is_active = TRUE
        LIMIT 1`,
      [requestDomain.toLowerCase()],
    );
    targetDepartmentId = wsRes.rows[0]?.id || targetDepartmentId;
  }

  const query = globalRoles.includes(role.toUpperCase())
    ? `SELECT id, email FROM users WHERE role = $1 AND is_active = true LIMIT 1`
    : `SELECT id, email FROM users WHERE role = $1 AND department_id = $2 AND is_active = true LIMIT 1`;
  const values = globalRoles.includes(role.toUpperCase())
    ? [role]
    : [role, targetDepartmentId];
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
  let { request_type, justification, items } = req.body;

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
  if (!req.user?.id || !req.user?.department_id)
    return next(createHttpError(400, "Invalid user context"));

  const userRole = (req.user.role || "").toLowerCase().replace(/_/g, "");
  const warehouseRoles = ["warehousekeeper", "warehousemanager"];

  if (request_type === "Stock" && !warehouseRoles.includes(userRole)) {
    return next(
      createHttpError(403, "Only warehouse staff can submit stock requests"),
    );
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

  const requester_id = req.user.id;
  const department_id = req.body.target_department_id || req.user.department_id;
  const section_id = req.body.target_section_id || req.user.section_id || null;

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
  }

  const itemNames = items.map((i) => i.item_name.toLowerCase());
  let duplicateFound = false;
  try {
    const table =
      request_type === "Warehouse Supply"
        ? "warehouse_supply_items"
        : "requested_items";
    const dupRes = await pool.query(
      `SELECT 1
       FROM requests r
       JOIN ${table} ri ON r.id = ri.request_id
       WHERE r.department_id = $1
         AND r.request_type = $3
         AND DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', CURRENT_DATE)
         AND LOWER(ri.item_name) = ANY($2::text[])
       LIMIT 1`,
      [department_id, itemNames, request_type],
    );
    duplicateFound = dupRes.rowCount > 0;

  } catch (err) {
    console.error("❌ Error checking duplicates:", err);
    return next(createHttpError(500, "Failed to validate duplicate requests"));
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let estimatedCost = 0;
    if (request_type !== "Stock") {
      estimatedCost = items.reduce((sum, item) => {
        const qty = parseInt(item.quantity) || 0;
        const unitCost = parseInt(item.unit_cost) || 0;
        return sum + qty * unitCost;
      }, 0);
    }

    const deptRes = await client.query(
      "SELECT type FROM departments WHERE id = $1",
      [department_id],
    );
    const deptType = deptRes.rows[0]?.type?.toLowerCase();
    let requestDomain = deptType === "medical" ? "medical" : "operational";

    if (request_type === "Warehouse Supply") {
      const supplied = req.body.supply_domain?.toLowerCase();
      if (["medical", "operational"].includes(supplied)) {
        requestDomain = supplied;
      }
    }

    const requestRes = await client.query(
      `INSERT INTO requests (
        request_type, requester_id, department_id, section_id, justification,
        estimated_cost, request_domain,
        maintenance_ref_number, initiated_by_technician_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        request_type,
        requester_id,
        department_id,
        section_id,
        justification,
        estimatedCost,
        requestDomain,
        maintenance_ref_number,
        initiated_by_technician_id,
      ],
    );

    const request = requestRes.rows[0];
    if (!request?.id)
      throw createHttpError(
        500,
        "❌ Failed to retrieve request ID after insertion",
      );

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
      const total_cost = (parseInt(quantity) || 0) * (parseInt(unit_cost) || 0);

      let requestedItemId = null;
      if (request_type !== "Warehouse Supply") {
        let insertedReq;
        if (request_type === "Stock") {
          insertedReq = await client.query(
            `INSERT INTO requested_items (
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
              total_cost,
              available_quantity || null,
              intended_use || null,
              specs || null,
            ],
          );
        } else {
          insertedReq = await client.query(
            `INSERT INTO requested_items (
              request_id,
              item_name,
              quantity,
              unit_cost,
              total_cost,
              available_quantity,
              intended_use,
              specs
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              request.id,
              item_name,
              quantity,
              unit_cost,
              total_cost,
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

    if (request_type === "Maintenance") {
      const designatedRequesterRes = await client.query(
        `SELECT id FROM users
         WHERE LOWER(role) = 'requester'
           AND department_id = $1
           AND ($2::int IS NULL OR section_id = $2)
           AND is_active = true
         LIMIT 1`,
        [department_id, section_id],
      );
      const designatedRequesterId = designatedRequesterRes.rows[0]?.id;
      if (!designatedRequesterId)
        throw createHttpError(
          400,
          "No designated requester found for this section",
        );

      await client.query(
        `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status)
        VALUES ($1, $2, 1, true, 'Pending')`,
        [request.id, designatedRequesterId],
      );
    } else {
      const domainForChain =
        request_type === "Warehouse Supply" ? requestDomain : deptType;

      const routes = await fetchApprovalRoutes(
        client,
        request_type,
        domainForChain,
        estimatedCost,
      );

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
        for (const { role, approval_level } of routes) {
          if (role === req.user.role && approval_level === 1) {
            await client.query(
              `INSERT INTO approvals (request_id, approver_id, approval_level, is_active, status, approved_at)
                 VALUES ($1, $2, $3, false, 'Approved', CURRENT_TIMESTAMP)`,
              [request.id, requester_id, approval_level],
            );
          } else {
            await assignApprover(
              client,
              role,
              department_id,
              request.id,
              request_type,
              approval_level,
              requestDomain,
            );
          }
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
        if (file.fieldname === "attachments") {
          requestFiles.push(file);
        } else if (file.fieldname.startsWith("item_")) {
          const idx = parseInt(file.fieldname.split("_")[1], 10);
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
          [request.id, file.originalname, file.path, requester_id],
        );
      }

      for (const [idx, files] of Object.entries(itemFiles)) {
        const itemId = itemIdMap[idx];
        if (!itemId) continue;
        for (const file of files) {
          await client.query(
            `INSERT INTO attachments (request_id, item_id, file_name, file_path, uploaded_by)
           VALUES ($1, $2, $3, $4, $5)`,
            [request.id, itemId, file.originalname, file.path, requester_id],
          );
        }
      }
    }

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

    await client.query("COMMIT");

    if (duplicateFound) {
      try {
        const { rows } = await pool.query(
          `SELECT email FROM users WHERE role IN ('ProcurementSupervisor', 'ProcurementSpecialist', 'SCM') AND is_active = true`,
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

    res.status(201).json({
      message: "✅ Request created successfully with approval routing",
      request_id: request.id,
      estimated_cost: estimatedCost,
      attachments_uploaded: req.files?.length || 0,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating request:", err);
    next(createHttpError(500, "Failed to create request"));
  } finally {
    client.release();
  }
};

module.exports = { createRequest, assignApprover };