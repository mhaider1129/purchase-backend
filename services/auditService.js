const pool = require("../config/db");

async function writeAuditEvent(event) {
  const {
    entityType,
    entityId,
    action,
    actorUserId = null,
    instituteId = null,
    requestId = null,
    correlationId = null,
    beforeData = null,
    afterData = null,
    metadata = null,
    reason = null,
    operationKey = null,
    client = null,
  } = event || {};
  if (!entityType || entityId == null || !action)
    throw new TypeError("entityType, entityId, and action are required");
  const critical =
    /^(?:APPROVAL_|PROCUREMENT_ASSIGNMENT_|REQUEST_CREATED|REQUEST_FINAL_|REQUEST_SCHEDULED_|DELIVERY_|TECHNICAL_|AWARD_|PO_|GOODS_RECEIPT_|FINANCE_VERIFIED|AP_VOUCHER_|PAYMENT_|CONTRACT_|RFID_|inventory\.movement\.|approval\.|request\.)/.test(
      action,
    );
  const criticalEntities = new Set([
    "request",
    "approval",
    "procurement_award",
    "purchase_order",
    "goods_receipt",
    "supplier_invoice",
    "ap_voucher",
    "payment",
    "inventory_movement",
    "contract",
    "rfid_read",
    "delivery_inspection",
    "preprocurement_technical_review",
  ]);
  if (critical || criticalEntities.has(String(entityType).toLowerCase()))
    await require("../utils/requireAuditTransaction")(client);
  const database = client || pool;
  if (operationKey) {
    await database.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,714))",
      [operationKey],
    );
    const previous = (
      await database.query(
        "SELECT * FROM audit_logs WHERE details::text LIKE $1 AND action=$2 AND target_type=$3 AND target_id=$4",
        [
          "%" + JSON.stringify(operationKey) + "%",
          action,
          entityType,
          String(entityId),
        ],
      )
    ).rows.find((row) => {
      try {
        return (
          (typeof row.details === "string"
            ? JSON.parse(row.details)
            : row.details
          )?.operationKey === operationKey
        );
      } catch (_) {
        return false;
      }
    });
    if (previous) {
      const evidence =
        typeof previous.details === "string"
          ? JSON.parse(previous.details)
          : previous.details;
      if (
        String(previous.actor_id ?? "") !== String(actorUserId ?? "") ||
        String(evidence.instituteId ?? "") !== String(instituteId ?? "")
      )
        throw Object.assign(new Error("Audit operation identity conflict"), {
          code: "AUDIT_IDEMPOTENCY_CONFLICT",
        });
      return previous;
    }
  }
  const details = {
    operationKey,
    instituteId,
    requestId,
    correlationId,
    beforeData,
    afterData,
    metadata,
    reason,
  };
  const result = await database.query(
    `INSERT INTO audit_logs (action, action_type, actor_id, target_type, target_id, description, details)
     VALUES ($1,$1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      action,
      actorUserId,
      entityType,
      String(entityId),
      reason || `${action} ${entityType}`,
      JSON.stringify(details),
    ],
  );
  return result.rows[0];
}

module.exports = { writeAuditEvent };
