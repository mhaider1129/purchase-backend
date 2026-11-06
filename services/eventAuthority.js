"use strict";
const fail = (code) =>
  Object.assign(new Error(code), { code, statusCode: 409, permanent: true });
// Fixed table allowlist: source identity is derived from actual document relationships.
const tables = {
  request: "requests",
  approval: "approvals",
  requested_item: "requested_items",
  procurement_award: "procurement_awards",
  purchase_order: "purchase_orders",
  goods_receipt: "goods_receipts",
  supplier_invoice: "supplier_invoices",
  ap_voucher: "ap_vouchers",
  payment: "payment_records",
  contract: "contracts",
  delivery_inspection: "delivery_inspection_tasks",
  preprocurement_technical_review: "preprocurement_technical_reviews",
  rfx_event: "rfx_events",
  rfx_response: "rfx_responses",
  rfid_read: "rfid_read_events",
  receipt_stock_status: "inventory_transactions",
  delivery_disposition: "technical_workflow_history",
};
async function resolve(client, event) {
  const payload = event.payload || {},
    type = String(event.entityType || event.entity_type || "").toLowerCase(),
    id = event.entityId ?? event.entity_id;
  let source = null,
    requestId = null,
    instituteId = null;
  if (Object.hasOwn(tables, type)) {
    source = (
      await client.query(`SELECT * FROM ${tables[type]} WHERE id=$1`, [id])
    ).rows[0];
    if (!source) throw fail("EVENT_SOURCE_NOT_FOUND");
    requestId = type === "request" ? source.id : source.request_id;
    instituteId = source.institute_id;
  }
  if (
    requestId == null &&
    source &&
    (source.requested_item_id || source.request_item_id)
  ) {
    requestId = (
      await client.query("SELECT request_id FROM requested_items WHERE id=$1", [
        source.requested_item_id || source.request_item_id,
      ])
    ).rows[0]?.request_id;
  }
  if (instituteId == null && source?.ap_voucher_id) {
    const voucher = (
      await client.query("SELECT * FROM ap_vouchers WHERE id=$1", [
        source.ap_voucher_id,
      ])
    ).rows[0];
    requestId = voucher?.request_id;
    source = { ...source, contract_id: voucher?.contract_id };
  }
  const hintedRequest = payload.requestId ?? payload.request_id;
  if (
    requestId != null &&
    hintedRequest != null &&
    String(requestId) !== String(hintedRequest)
  )
    throw fail("EVENT_SOURCE_IDENTITY_CONFLICT");
  requestId = requestId ?? hintedRequest;
  if (requestId != null) {
    const request = (
      await client.query("SELECT * FROM requests WHERE id=$1", [requestId])
    ).rows[0];
    if (!request) throw fail("EVENT_SOURCE_NOT_FOUND");
    if (
      instituteId != null &&
      Number(instituteId) !== Number(request.institute_id)
    )
      throw fail("EVENT_INSTITUTE_CONFLICT");
    instituteId = request.institute_id;
    source = { ...source, request };
  }
  if (instituteId == null && source?.contract_id != null) {
    const contract = (
      await client.query("SELECT institute_id FROM contracts WHERE id=$1", [
        source.contract_id,
      ])
    ).rows[0];
    instituteId = contract?.institute_id;
  }
  const ids = payload.requestedItemIds || payload.requested_item_ids || [];
  if (ids.length) {
    const owners = (
      await client.query(
        "SELECT DISTINCT r.institute_id FROM requested_items i JOIN requests r ON r.id=i.request_id WHERE i.id=ANY($1::integer[])",
        [ids],
      )
    ).rows;
    if (
      owners.length !== 1 ||
      (instituteId != null &&
        Number(instituteId) !== Number(owners[0].institute_id))
    )
      throw fail("EVENT_INSTITUTE_CONFLICT");
    instituteId = owners[0].institute_id;
  }
  const declared =
    event.instituteId ??
    event.institute_id ??
    payload.instituteId ??
    payload.institute_id;
  if (
    declared != null &&
    (instituteId == null || Number(declared) !== Number(instituteId))
  )
    throw fail("EVENT_INSTITUTE_CONFLICT");
  return {
    instituteId: instituteId ?? null,
    requestId: requestId ?? null,
    source,
  };
}
async function recipient(client, event, context = null) {
  const userId = event.recipient_user_id ?? event.userId;
  if (!userId) return null;
  const scope = context || (await resolve(client, event));
  if (scope.instituteId == null) return null;
  const user = (
    await client.query(
      "SELECT * FROM users WHERE id=$1 AND institute_id=$2 AND is_active=true FOR SHARE",
      [userId, scope.instituteId],
    )
  ).rows[0];
  if (!user) return null;
  if (event.event_type === "PROCUREMENT_ASSIGNMENT_CHANGED") {
    try {
      await require("./procurementAssignmentPolicy")
        .createAssignmentPolicy()
        .assignee(user.id, scope.instituteId, client);
    } catch (e) {
      if ([400, 403, 404].includes(e.statusCode)) return null;
      throw e;
    }
    const assigned = await client.query(
      "SELECT id FROM requested_items WHERE request_id=$1 AND assigned_to=$2 LIMIT 1",
      [scope.requestId, user.id],
    );
    if (
      Number(scope.source?.request?.assigned_to) !== Number(user.id) &&
      !assigned.rowCount
    )
      return null;
  }
  const { getPermissionsForUserId } = require("../utils/permissionService");
  const grants = await getPermissionsForUserId(user.id, client);
  user.permissions = grants.permissions || [];
  user.data_scopes = grants.dataScopes || {};
  if (
    String(event.entity_type || event.entityType).toLowerCase() ===
    "delivery_inspection"
  ) {
    try {
      await require("./deliveryInspectionService")
        .createDeliveryInspectionService(client)
        .get(user, event.entity_id ?? event.entityId, client);
      return user;
    } catch (error) {
      if ([403, 404].includes(error.statusCode)) return null;
      throw error;
    }
  }
  if (
    String(event.entity_type || event.entityType).toLowerCase() ===
    "preprocurement_technical_review"
  ) {
    try {
      await require("./preprocurementTechnicalReviewService")
        .createTechnicalReviewService(client)
        .get(user, event.entity_id ?? event.entityId, client);
      return user;
    } catch (error) {
      if ([403, 404].includes(error.statusCode)) return null;
      throw error;
    }
  }
  if (scope.requestId != null) {
    const authorized =
      await require("./requestAuthorizationService").findAuthorizedRequest({
        requestId: scope.requestId,
        user,
        database: client,
        instituteIds: [scope.instituteId],
      });
    if (!authorized) return null;
    const approvalId = event.payload?.approvalId;
    if (
      approvalId &&
      [
        "approved",
        "rejected",
        "cancelled",
        "canceled",
        "completed",
        "closed",
        "received",
        "available in stock",
      ].includes(
        String(scope.source?.request?.status || "")
          .trim()
          .toLowerCase(),
      )
    )
      return null;
    if (
      approvalId &&
      !(
        await client.query(
          "SELECT id FROM approvals WHERE id=$1 AND request_id=$2 AND approver_id=$3 AND is_active=true AND status IN ('Pending','On Hold') AND COALESCE(is_superseded,false)=false",
          [approvalId, scope.requestId, user.id],
        )
      ).rowCount
    )
      return null;
  } else if (
    String(event.entity_type || event.entityType).toLowerCase() === "rfid_read"
  ) {
    if (
      !user.permissions.some((p) =>
        ["rfid.view", "rfid.manage-infrastructure"].includes(p),
      )
    )
      return null;
  } else return null; // No implicit supplier/internal account conversion or new document-view policy.
  return user;
}
module.exports = { resolve, recipient, fail };
