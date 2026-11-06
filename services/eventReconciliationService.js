"use strict";
const pool = require("../config/db");
const { getPermissionsForUserId } = require("../utils/permissionService");
const registry = [
  {
    domain: "award",
    table: "procurement_awards",
    scope: "request_id",
    status: "b.status IN ('ACTIVE','CANCELLED','SUPERSEDED')",
    action: "AWARD_CREATED",
    entity: "procurement_award",
    outbox: "AWARD_CREATED",
  },
  {
    domain: "purchase_order",
    table: "purchase_orders",
    key: "id",
    scope: "request_id",
    status: "b.status IN ('PO_ISSUED','PO_PARTIAL','PO_DELIVERED','PO_CLOSED')",
    action: "PO_ISSUED",
    entity: "purchase_order",
    outbox: "PO_ISSUED",
  },
  {
    domain: "goods_receipt",
    table: "goods_receipts",
    key: "id",
    scope: "request_id",
    status: "true",
    action: "GOODS_RECEIPT_POSTED",
    entity: "goods_receipt",
    outbox: "GOODS_RECEIPT_POSTED",
  },
  {
    domain: "supplier_invoice",
    table: "supplier_invoices",
    key: "id",
    scope: "request_id",
    status:
      "b.status IN ('FINANCE_VERIFIED','AP_VOUCHER_CREATED','AP_POSTED','PAYMENT_PENDING','PARTIALLY_PAID','PAID','CLOSED')",
    action: "FINANCE_VERIFIED",
    entity: "supplier_invoice",
    outbox: "FINANCE_VERIFIED",
  },
  {
    domain: "ap_posting",
    table: "ap_vouchers",
    key: "id",
    scope: "request_id",
    status: "b.voucher_status='posted'",
    action: "AP_VOUCHER_POSTED",
    entity: "ap_voucher",
    outbox: "AP_VOUCHER_POSTED",
  },
  {
    domain: "payment",
    table: "payment_records",
    key: "id",
    scope: "request_id",
    status: "b.payment_status='paid' AND b.reversal_of_payment_id IS NULL",
    action: "PAYMENT_COMPLETED",
    entity: "payment",
    outbox: "PAYMENT_COMPLETED",
  },
];
async function diagnostic(database, instituteId) {
  const findings = [];
  for (const entry of registry) {
    const rows = await database.query(
      `SELECT $2::text domain,b.id::text source_id,
 NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.target_type=$3 AND a.target_id::text=b.id::text AND a.action=ANY($4::text[])) missing_audit,
 NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.entity_type=$3 AND o.entity_id=b.id::text AND o.event_type=ANY($4::text[])) missing_outbox,
 'REVIEW_REQUIRED_NO_HISTORICAL_INFERENCE'::text evidence_status
 FROM ${entry.table} b LEFT JOIN requests r ON r.id=b.${entry.scope} ${["purchase_order", "supplier_invoice", "ap_posting"].includes(entry.domain) ? "LEFT JOIN contracts c ON c.id=b.contract_id" : entry.domain === "payment" ? "LEFT JOIN ap_vouchers v ON v.id=b.ap_voucher_id LEFT JOIN contracts c ON c.id=v.contract_id" : ""} WHERE ${["purchase_order", "supplier_invoice", "ap_posting", "payment"].includes(entry.domain) ? "COALESCE(r.institute_id,c.institute_id)" : "r.institute_id"}=$1 AND ${entry.status} AND
 (NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.target_type=$3 AND a.target_id::text=b.id::text AND a.action=ANY($4::text[])) OR NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.entity_type=$3 AND o.entity_id=b.id::text AND o.event_type=ANY($4::text[]))) ORDER BY b.id DESC LIMIT 100`,
      [
        instituteId,
        entry.domain,
        entry.entity,
        entry.domain === "payment"
          ? ["PAYMENT_COMPLETED", "PAYMENT_PARTIAL"]
          : [entry.action],
      ],
    );
    findings.push(...rows.rows);
  }
  findings.push(
    ...(
      await database.query(
        `WITH evidence AS (
 SELECT l.id,'assignment'::text domain,l.id::text source_id,
 NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.target_type='request' AND a.target_id=l.request_id AND a.action='PROCUREMENT_ASSIGNMENT_CHANGED' AND a.details::text ~ ('"logId"[[:space:]]*:[[:space:]]*'||l.id::text||'[,}]')) missing_audit,
 NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.event_type='PROCUREMENT_ASSIGNMENT_CHANGED' AND o.entity_type='request' AND o.entity_id=l.request_id::text AND o.payload->>'logId'=l.id::text) missing_outbox,
 'REVIEW_REQUIRED_NO_HISTORICAL_INFERENCE'::text evidence_status
 FROM request_logs l JOIN requests r ON r.id=l.request_id WHERE r.institute_id=$1 AND l.action IN ('Auto-assigned to procurement','split_assigned_to_procurement','reassigned_to_procurement','assigned_to_procurement'))
 SELECT domain,source_id,missing_audit,missing_outbox,evidence_status FROM evidence WHERE missing_audit OR missing_outbox ORDER BY id DESC LIMIT 100`,
        [instituteId],
      )
    ).rows,
  );
  const approvals = (
    await database.query(
      `SELECT 'approval'::text domain,a.id::text source_id,NOT EXISTS(SELECT 1 FROM approval_logs l WHERE l.approval_id=a.id AND l.action IN ('Approved','Rejected',a.status)) missing_audit,false missing_outbox,'REVIEW_REQUIRED_NO_HISTORICAL_INFERENCE'::text evidence_status FROM approvals a JOIN requests r ON r.id=a.request_id WHERE r.institute_id=$1 AND a.status IN ('Approved','Rejected') AND NOT EXISTS(SELECT 1 FROM approval_logs l WHERE l.approval_id=a.id AND l.action IN ('Approved','Rejected',a.status)) ORDER BY a.id DESC LIMIT 100`,
      [instituteId],
    )
  ).rows;
  findings.push(...approvals);
  const other = [
    [
      "preprocurement_technical_review",
      "preprocurement_technical_reviews",
      "institute_id",
      "true",
      "TECHNICAL_%",
    ],
    [
      "inventory_movement",
      "inventory_transactions",
      "institute_id",
      "t.movement_type IS NOT NULL",
      "inventory.movement.posted",
    ],
    ["contract", "contracts", "institute_id", "true", "CONTRACT_%"],
    [
      "delivery_inspection",
      "delivery_inspection_tasks",
      "institute_id",
      "t.status IN ('DECIDED','CLOSED')",
      "DELIVERY_%",
    ],
    [
      "rfid_read",
      "rfid_read_events",
      "institute_id",
      "t.processing_status='PROCESSED'",
      "RFID_READ_PROCESSED",
    ],
  ];
  for (const [domain, table, scope, predicate, action] of other) {
    findings.push(
      ...(
        await database.query(
          `SELECT $2::text domain,t.id::text source_id,true missing_audit,false missing_outbox,'REVIEW_REQUIRED_NO_HISTORICAL_INFERENCE'::text evidence_status FROM ${table} t WHERE t.${scope}=$1 AND ${predicate} AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE lower(a.target_type)=lower($2) AND a.target_id::text=t.id::text AND a.action LIKE $3) ORDER BY t.id DESC LIMIT 100`,
          [instituteId, domain, action],
        )
      ).rows,
    );
  }
  const outbox = (
    await database.query(
      "SELECT id,event_type,entity_type,entity_id,status,retry_count,created_at,next_attempt_at,processing_started_at,error_category FROM notification_outbox WHERE institute_id=$1  ORDER BY id DESC LIMIT 100",
      [instituteId],
    )
  ).rows;
  const emails = (
    await database.query(
      "SELECT id,outbox_event_id,status,attempt_count,last_attempt_at,lease_expires_at,next_attempt_at,acknowledged_at,error_category FROM notification_email_deliveries WHERE institute_id=$1 ORDER BY id DESC LIMIT 100",
      [instituteId],
    )
  ).rows;
  const duplicates = (
    await database.query(
      "SELECT event_type,entity_type,entity_id,recipient_user_id,count(*)::integer count FROM notification_outbox WHERE institute_id=$1 GROUP BY event_type,entity_type,entity_id,recipient_user_id HAVING count(*)>1 ORDER BY count(*) DESC LIMIT 100",
      [instituteId],
    )
  ).rows;
  return {
    cutover: (
      await database.query(
        "SELECT version,installed_at FROM event_reliability_cutovers ORDER BY installed_at",
      )
    ).rows,
    findings,
    outbox,
    outboxSummary: (
      await database.query(
        "SELECT status,count(*)::integer count,min(created_at) oldest_created_at,min(next_attempt_at) next_attempt_at FROM notification_outbox WHERE institute_id=$1 GROUP BY status ORDER BY status",
        [instituteId],
      )
    ).rows,
    emailSummary: (
      await database.query(
        "SELECT status,count(*)::integer count,min(created_at) oldest_created_at,min(next_attempt_at) next_attempt_at FROM notification_email_deliveries WHERE institute_id=$1 GROUP BY status ORDER BY status",
        [instituteId],
      )
    ).rows,
    emailDeliveries: emails,
    duplicateCandidates: duplicates,
    note: "Absence or repeated source identity requires review; neither proves an unrecorded business operation or duplicate external delivery. Historical evidence is never backfilled.",
  };
}
async function forActor(actor, database = pool) {
  const client = await database.connect();
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await client.query("SET LOCAL statement_timeout='15s'");
    const user = (
      await client.query(
        "SELECT id,institute_id,is_active FROM users WHERE id=$1",
        [actor?.id],
      )
    ).rows[0];
    if (!user?.is_active || user.institute_id == null)
      throw Object.assign(new Error("Active institute auditor required"), {
        statusCode: 403,
      });
    const grants = await getPermissionsForUserId(user.id, client);
    if (!grants.permissions.includes("operations.events.view"))
      throw Object.assign(new Error("Event reliability permission required"), {
        statusCode: 403,
      });
    const result = await diagnostic(client, user.institute_id);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
module.exports = { forActor, diagnostic, registry };
