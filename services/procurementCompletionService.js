"use strict";
const withTransaction = require("../utils/withTransaction");
const contractAuth = require("./contractAuthorizationService");
const fail = (statusCode, message, code = "COMPLETION_EVIDENCE_REQUIRED") =>
  Object.assign(new Error(message), { statusCode, code });
const id = (value) => {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw fail(400, "A positive request ID is required", "INVALID_REQUEST_ID");
  return Number(value);
};
async function actor(client, input) {
  const a = await contractAuth.actor(input, client);
  const extra = (
    await client.query(
      "SELECT warehouse_id,section_id FROM users WHERE id=$1 FOR SHARE",
      [a.id],
    )
  ).rows[0];
  return Object.assign(a, extra);
}
async function schema(client) {
  if (
    !(
      await client.query(
        "SELECT (to_regprocedure('public.canonical_procurement_completion(integer,integer,integer)') IS NOT NULL AND to_regprocedure('public.canonical_receipt_inventory_quantity(bigint,integer,text,bigint)') IS NOT NULL) AS ready",
      )
    ).rows[0]?.ready
  )
    throw fail(
      503,
      "Apply manual SQL 067 and 068 before procurement completion",
      "COMPLETION_SCHEMA_REQUIRED",
    );
}
async function project(client, request) {
  await schema(client);
  const value = (
    await client.query(
      "SELECT public.canonical_procurement_completion($1,$2,NULL) AS completion",
      [request.id, request.institute_id],
    )
  ).rows[0]?.completion;
  if (!value)
    throw fail(
      404,
      "Request or completion source not found",
      "REQUEST_NOT_FOUND",
    );
  return value;
}
async function canRead(client, a, r) {
  const sameInstitute = String(a.institute_id) === String(r.institute_id);
  const cross =
    a.hasPermission("requests.cross-institute") &&
    (a.data_scopes?.institute_ids || [])
      .map(String)
      .includes(String(r.institute_id));
  if (!sameInstitute && !cross)
    throw fail(404, "Request not found", "REQUEST_NOT_FOUND");
  const owned =
    String(r.requester_id) === String(a.id) ||
    String(r.assigned_to) === String(a.id);
  const warehouse =
    r.request_type === "Warehouse Supply" &&
    String(a.warehouse_id) === String(r.supply_warehouse_id) &&
    (a.hasPermission("warehouse.view-supply") ||
      a.hasPermission("warehouse.manage-supply"));
  const department =
    String(a.department_id) === String(r.department_id) &&
    a.hasPermission("requests.view");
  const privileged =
    a.hasPermission("requests.manage") ||
    a.hasPermission("requests.view-all") ||
    a.hasPermission("procure-to-pay.lifecycle.view");
  const linked =
    (
      await client.query(
        "SELECT 1 FROM approvals WHERE request_id=$1 AND approver_id=$2 UNION ALL SELECT 1 FROM requested_items WHERE request_id=$1 AND assigned_to=$2 LIMIT 1",
        [r.id, a.id],
      )
    ).rowCount > 0;
  if (!owned && !warehouse && !department && !privileged && !linked)
    throw fail(404, "Request not found", "REQUEST_NOT_FOUND");
}
async function get(requestId, input, suppliedClient = null) {
  return withTransaction(
    async (client) => {
      const a = await actor(client, input);
      const r = (
        await client.query("SELECT * FROM requests WHERE id=$1 FOR SHARE", [
          id(requestId),
        ])
      ).rows[0];
      if (!r) throw fail(404, "Request not found", "REQUEST_NOT_FOUND");
      await canRead(client, a, r);
      return project(client, r);
    },
    { client: suppliedClient },
  );
}
async function assertLifecycleCompletion(client, request, input) {
  if (!["Completed", "Received", "Closed"].includes(input.toStatus)) return;
  if (
    input.toStatus === "Completed" &&
    String(request.status).toLowerCase() === "received" &&
    input.metadata?.receiptIssue === true &&
    String(request.requester_id) === String(input.actor?.id)
  ) {
    const issue = (
      await client.query(
        "SELECT 1 FROM requested_items WHERE request_id=$1 AND received_by=$2 AND NULLIF(trim(receipt_issue_status),'') IS NOT NULL LIMIT 1",
        [request.id, input.actor.id],
      )
    ).rowCount;
    if (issue) return;
  }
  // Reversal locks the original movement FOR UPDATE. Hold the same source rows
  // FOR SHARE until lifecycle audit/outbox commit, then take a fresh projection.
  await client.query(
    `WITH RECURSIVE completion_sources AS (SELECT m.id FROM inventory_transactions m WHERE
   (m.source_document_type='goods_receipt' AND EXISTS(SELECT 1 FROM goods_receipts gr WHERE gr.id::text=m.source_document_id AND gr.request_id=$1))
   OR (m.source_document_type='warehouse_supply' AND (m.source_document_id=$1::text OR EXISTS(
     SELECT 1 FROM warehouse_supply_items wsi JOIN requested_items ri ON ri.id=wsi.requested_item_id
     WHERE wsi.request_id::text=m.source_document_id AND ri.request_id=$1)))
   UNION SELECT rv.id FROM inventory_transactions rv JOIN completion_sources p ON rv.reversal_of_movement_id=p.id)
   SELECT m.id FROM inventory_transactions m JOIN completion_sources s ON s.id=m.id ORDER BY m.id FOR SHARE OF m`,
    [request.id],
  );
  const c = await project(client, request);
  if (
    !c.can_complete &&
    !(
      String(request.status).toLowerCase() === "closed" &&
      c.fulfillment_complete
    )
  )
    throw fail(
      409,
      "Approved demand requires accepted receiving or verified warehouse issue evidence before completion",
    );
  if (input.toStatus === "Received" && !c.requester_acknowledgment_complete)
    throw fail(409, "Requester acknowledgment is incomplete");
  return c;
}
async function complete(requestId, input, suppliedClient = null) {
  return withTransaction(
    async (client) => {
      const a = await actor(client, input);
      const r = (
        await client.query("SELECT * FROM requests WHERE id=$1 FOR UPDATE", [
          id(requestId),
        ])
      ).rows[0];
      if (!r) throw fail(404, "Request not found", "REQUEST_NOT_FOUND");
      await canRead(client, a, r);
      const warehouse = r.request_type === "Warehouse Supply";
      const permission = warehouse
        ? "warehouse.manage-supply"
        : "requests.manage";
      if (!a.hasPermission(permission))
        throw fail(
          403,
          `Permission required: ${permission}`,
          "PERMISSION_DENIED",
        );
      if (
        warehouse &&
        (String(a.warehouse_id) !== String(r.supply_warehouse_id) ||
          String(a.institute_id) !== String(r.institute_id))
      )
        throw fail(
          403,
          "Warehouse completion is outside the assigned institute/warehouse",
          "WAREHOUSE_SCOPE_DENIED",
        );
      const result = await require("./requestLifecycleService").transition(
        {
          requestId: r.id,
          actor: a,
          toStatus: "Completed",
          permission,
          expectedStatus: r.status,
          allowIdempotent: true,
          idempotencyKey: `request-completion:${r.id}`,
          reason: "Authoritative quantities satisfy approved demand",
        },
        client,
      );
      return { ...result, completion: await project(client, r) };
    },
    { client: suppliedClient },
  );
}
module.exports = {
  get,
  project,
  actor,
  canRead,
  complete,
  assertLifecycleCompletion,
  schema,
  fail,
};
