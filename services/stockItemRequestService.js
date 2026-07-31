const pool = require("../config/db");
const createHttpError = require("../utils/httpError");
const { createNotification } = require("../utils/notificationService");
const { DatabaseCapabilityService } = require("./databaseCapabilityService");
const requestRepository = require("../repositories/stockItemRequestRepository");
const legacyCreationService = require("./legacyStockItemCreationService");

const review = async ({ input, reviewerId }) => {
  await requestRepository.ensureColumns(pool);
  const client = await pool.connect();
  let inTransaction = false;
  try {
    if (input.status === "approved") {
      const capabilities = new DatabaseCapabilityService(client, { ttlMs: 0 });
      await capabilities.require("legacyStockItemExceptionAvailable");
    }
    await client.query("BEGIN");
    inTransaction = true;
    const request = await requestRepository.findForUpdate(client, input.id);
    if (!request) throw createHttpError(404, "Request not found");
    if (request.status !== "pending") {
      const error = createHttpError(409, "This request has already been reviewed");
      error.code = "stock_item_request_already_reviewed";
      throw error;
    }

    let stockItem = null;
    let auditAction = "legacy_creation_rejected";
    if (input.status === "approved") {
      const outcome = await legacyCreationService.createOrReuse(client, request);
      stockItem = {
        id: outcome.item.id,
        created: outcome.created,
        reused: outcome.reused,
      };
      auditAction = outcome.created
        ? "legacy_creation_approved"
        : "legacy_creation_reused";
      await requestRepository.writeItemMasterAudit(client, {
        stockItemId: stockItem.id,
        action: auditAction,
        actorId: reviewerId,
        reason: input.legacyCreationReason,
        requestId: input.id,
      });
    }

    const updated = await requestRepository.updateStatus(client, {
      id: input.id,
      status: input.status,
      reviewerId,
      reviewNotes: input.reviewNotes,
    });
    if (!updated) throw createHttpError(409, "Request review conflict");

    await requestRepository.writeAudit(client, {
      action: input.status === "approved"
        ? "Stock Item Request Approved"
        : "Stock Item Request Rejected",
      actorId: reviewerId,
      requestId: input.id,
      description: `${input.status} stock item request ${input.id}`,
    });
    if (Number.isInteger(request.requested_by)) {
      await createNotification({
        userId: request.requested_by,
        title: "Stock item request review",
        message: `Your stock item request for "${request.name}" was ${input.status}.`,
        metadata: { requestId: input.id, status: input.status },
      }, client);
    }
    await client.query("COMMIT");
    inTransaction = false;
    return { request: updated, stock_item: stockItem, audit_action: auditAction };
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { review };