const pool = require("../config/db");
const createHttpError = require("../utils/httpError");
const stockItemRequestService = require("../services/stockItemRequestService");
const { validateReview } = require("../validators/stockItemRequestValidator");
const { userHasPermission } = require("../utils/permissionService");

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_UNIT_LENGTH = 50;

const normalizeText = (value) => {
  if (value == null) return "";
  return String(value).trim();
};

// Create a new stock item request (Warehouse Manager)
const createStockItemRequest = async (req, res, next) => {
  const { name, description, unit } = req.body || {};
  const userId = req.user?.id ?? req.user?.user_id;
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    return next(createHttpError(401, "Unauthorized: Missing user context"));
  }
  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    return next(createHttpError(400, "Item name is required"));
  }

  if (normalizedName.length > MAX_NAME_LENGTH) {
    return next(
      createHttpError(
        400,
        `Item name must be ${MAX_NAME_LENGTH} characters or fewer`,
      ),
    );
  }

  const normalizedDescription = normalizeText(description) || null;
  if (
    normalizedDescription &&
    normalizedDescription.length > MAX_DESCRIPTION_LENGTH
  ) {
    return next(
      createHttpError(
        400,
        `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
      ),
    );
  }

  const normalizedUnit = normalizeText(unit) || null;
  if (normalizedUnit && normalizedUnit.length > MAX_UNIT_LENGTH) {
    return next(
      createHttpError(
        400,
        `Unit must be ${MAX_UNIT_LENGTH} characters or fewer`,
      ),
    );
  }

  try {
    const duplicateStockItem = await pool.query(
      `SELECT id, unit
         FROM stock_items
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1`,
      [normalizedName],
    );

    if (duplicateStockItem.rowCount > 0) {
      return next(
        createHttpError(
          409,
          "A stock item with this name already exists in inventory" +
            (duplicateStockItem.rows[0].unit
              ? ` (unit: ${duplicateStockItem.rows[0].unit})`
              : ""),
        ),
      );
    }

    const duplicateRequest = await pool.query(
      `SELECT id, status
         FROM stock_item_requests
        WHERE LOWER(name) = LOWER($1)
          AND status = 'pending'
        LIMIT 1`,
      [normalizedName],
    );

    if (duplicateRequest.rowCount > 0) {
      return next(
        createHttpError(
          409,
          "A pending stock item request with this name and unit already exists",
        ),
      );
    }

    const result = await pool.query(
      `INSERT INTO stock_item_requests (name, description, unit, requested_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [normalizedName, normalizedDescription, normalizedUnit, userId],
    );
    res.status(201).json({
      message: "Stock item request submitted for review",
      request: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Failed to create stock item request:", err.message);
    next(createHttpError(500, "Failed to create stock item request"));
  }
};

// Fetch stock item requests
const getStockItemRequests = async (req, res, next) => {
  const { id: userId } = req.user;
  try {
    let result;
    if (userHasPermission(req.user, "stock-requests.review")) {
      result = await pool.query(
        `SELECT * FROM stock_item_requests ORDER BY inserted_at DESC`,
      );
    } else if (userHasPermission(req.user, "stock-requests.create")) {
      result = await pool.query(
        `SELECT * FROM stock_item_requests WHERE requested_by = $1 ORDER BY inserted_at DESC`,
        [userId],
      );
    } else {
      return next(
        createHttpError(
          403,
          "You do not have permission to view stock item requests",
        ),
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Failed to fetch stock item requests:", err.message);
    next(createHttpError(500, "Failed to fetch stock item requests"));
  }
};

// Update request status (SCM approval)
const updateStockItemRequestStatus = async (req, res, next) => {
  try {
    const input = validateReview(req.params, req.body || {});
    const result = await stockItemRequestService.review({
      input,
      reviewerId: req.user.id,
    });
    return res.json(result);
  } catch (err) {
    return next(
      err.statusCode
        ? err
        : createHttpError(500, "Failed to update stock item request status"),
    );
  }
};

module.exports = {
  createStockItemRequest,
  getStockItemRequests,
  updateStockItemRequestStatus,
};