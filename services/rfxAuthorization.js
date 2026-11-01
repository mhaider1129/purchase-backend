"use strict";
const pool = require("../config/db");
const finance = require("./p2pAuthorization");
const { writeAuditEvent } = require("./auditService");
const missing = () =>
  finance.fail(
    404,
    "Sourcing document or reference not found",
    "RFX_NOT_FOUND",
  );
const equal = (a, b) => a != null && b != null && String(a) === String(b);

// No sourcing-specific cross-institute capability exists. Request/inventory
// overrides, body institute IDs and a role label cannot extend this boundary.
async function authorize(
  client,
  actor,
  { requestId, eventId, responseId, itemId, supplierId } = {},
) {
  actor = await finance.loadActor(client, actor, "rfx.manage");
  if (requestId != null) requestId = finance.id(requestId);
  let event;
  if (eventId != null) {
    event = (
      await client.query("SELECT * FROM rfx_events WHERE id=$1", [
        finance.id(eventId),
      ])
    ).rows[0];
    if (
      !event?.request_id ||
      (requestId != null && !equal(event.request_id, requestId))
    )
      throw missing();
    requestId = event.request_id;
  }
  if (itemId != null) {
    const item = (
      await client.query("SELECT * FROM requested_items WHERE id=$1", [
        finance.id(itemId),
      ])
    ).rows[0];
    if (
      !item?.request_id ||
      (requestId != null && !equal(item.request_id, requestId))
    )
      throw missing();
    requestId = item.request_id;
  }
  const context = await finance.authorizeCommand(
    { client },
    actor,
    "rfx.manage",
    { requestId },
  );
  if (!requestId) throw missing(); // Unlinked legacy events have no proven owner.
  if (event) {
    const locked = (
      await client.query("SELECT * FROM rfx_events WHERE id=$1 FOR UPDATE", [
        event.id,
      ])
    ).rows[0];
    if (!locked || !equal(locked.request_id, requestId)) throw missing();
    event = locked;
  }
  let response;
  if (responseId != null) {
    response = (
      await client.query("SELECT * FROM rfx_responses WHERE id=$1 FOR UPDATE", [
        finance.id(responseId),
      ])
    ).rows[0];
    if (
      !response ||
      !event ||
      !equal(response.rfx_id, event.id) ||
      (response.request_id != null && !equal(response.request_id, requestId))
    )
      throw missing();
    supplierId = response.supplier_id;
    const lines = (
      await client.query(
        "SELECT q.*,ri.request_id AS item_request_id FROM rfx_response_items q LEFT JOIN requested_items ri ON ri.id=q.requested_item_id WHERE q.rfx_response_id=$1 ORDER BY q.id FOR SHARE OF q",
        [response.id],
      )
    ).rows;
    for (const line of lines) {
      if (!equal(line.item_request_id, requestId)) throw missing();
      await assertProductScope(
        client,
        line.approved_product_id,
        context.instituteId,
      );
    }
  }
  if (supplierId != null)
    await assertSupplier(client, supplierId, context.instituteId);
  return { ...context, requestId, event, response };
}
async function assertSupplier(client, supplierId, instituteId) {
  const supplier = (
    await client.query("SELECT * FROM suppliers WHERE id=$1 FOR SHARE", [
      finance.id(supplierId),
    ])
  ).rows[0];
  if (
    !supplier ||
    (supplier.institute_id != null &&
      !equal(supplier.institute_id, instituteId))
  )
    throw missing();
  return supplier;
}
async function assertProductScope(client, productId, instituteId) {
  if (productId == null) return;
  const product = (
    await client.query(
      "SELECT * FROM approved_products WHERE id=$1 FOR SHARE",
      [finance.id(productId)],
    )
  ).rows[0];
  if (
    !product ||
    (product.institute_id != null && !equal(product.institute_id, instituteId))
  )
    throw missing();
}
async function resolveSupplier(client, input, instituteId) {
  if (input.supplier_id != null)
    return assertSupplier(client, input.supplier_id, instituteId);
  const rows = (
    await client.query(
      `SELECT * FROM suppliers WHERE LOWER(TRIM(name))=LOWER(TRIM($1)) AND (institute_id=$2 OR institute_id IS NULL) ORDER BY id FOR SHARE`,
      [input.supplier_name || "", instituteId],
    )
  ).rows;
  if (rows.length !== 1)
    throw finance.fail(
      400,
      "Choose one existing supplier by ID; supplier name is missing or ambiguous",
      "RFX_SUPPLIER_REQUIRED",
    );
  return rows[0]; // Names never create or attest supplier accounts.
}
function eventPredicate(a = "e", parameter = "$1") {
  return `EXISTS(SELECT 1 FROM requests scope_r JOIN departments scope_d ON scope_d.id=scope_r.department_id WHERE scope_r.id=${a}.request_id AND scope_r.institute_id=${parameter} AND scope_d.institute_id=scope_r.institute_id)`;
}
function responsePredicate(a = "resp", event = "e") {
  return `(${a}.request_id IS NULL OR ${a}.request_id=${event}.request_id) AND EXISTS(SELECT 1 FROM suppliers scope_s WHERE scope_s.id=${a}.supplier_id AND (scope_s.institute_id IS NULL OR scope_s.institute_id=(SELECT institute_id FROM requests WHERE id=${event}.request_id))) AND NOT EXISTS(SELECT 1 FROM rfx_response_items scope_q LEFT JOIN requested_items scope_i ON scope_i.id=scope_q.requested_item_id LEFT JOIN approved_products scope_p ON scope_p.id=scope_q.approved_product_id WHERE scope_q.rfx_response_id=${a}.id AND (scope_i.request_id IS DISTINCT FROM ${event}.request_id OR (scope_q.approved_product_id IS NOT NULL AND (scope_p.id IS NULL OR (scope_p.institute_id IS NOT NULL AND scope_p.institute_id IS DISTINCT FROM (SELECT institute_id FROM requests WHERE id=${event}.request_id))))))`;
}
// Pure bound-source predicate shared with financial reads/PO graph validation.
// A quotation line ID is authoritative when present; ambiguous legacy aggregate
// IDs are not reinterpreted as a different quotation.
function awardSourcePredicate(a = "pa") {
  const header = (rr, evt) =>
    `${evt}.request_id=${a}.request_id AND (${rr}.request_id IS NULL OR ${rr}.request_id=${a}.request_id) AND ${rr}.supplier_id=${a}.supplier_id`;
  const line = `EXISTS(SELECT 1 FROM rfx_response_items source_q JOIN rfx_responses source_rr ON source_rr.id=source_q.rfx_response_id JOIN rfx_events source_e ON source_e.id=source_rr.rfx_id WHERE source_q.id::text=${a}.source_id::text AND source_q.requested_item_id=${a}.request_item_id AND ${header("source_rr", "source_e")})`;
  const aggregate = `EXISTS(SELECT 1 FROM rfx_responses source_ar JOIN rfx_events source_ae ON source_ae.id=source_ar.rfx_id WHERE source_ar.id::text=${a}.source_id::text AND ${header("source_ar", "source_ae")} AND NOT EXISTS(SELECT 1 FROM rfx_response_items source_aq WHERE source_aq.rfx_response_id=source_ar.id))`;
  return `(UPPER(${a}.source_type) NOT IN ('QUOTATION','RFX_RESPONSE') OR (UPPER(${a}.source_type)='QUOTATION' AND (${line} OR (NOT EXISTS(SELECT 1 FROM rfx_response_items source_collision WHERE source_collision.id::text=${a}.source_id::text) AND ${aggregate}))) OR (UPPER(${a}.source_type)='RFX_RESPONSE' AND ${aggregate}))`;
}
async function assertAwardOwnership(client, awardId) {
  const found = await client.query(
    `SELECT pa.id FROM procurement_awards pa WHERE pa.id=$1 AND ${awardSourcePredicate("pa")}`,
    [awardId],
  );
  if (!found.rowCount) throw missing();
}
async function transaction(actor, refs, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Check capability before looking up potentially foreign IDs.
    const current = await finance.loadActor(client, actor, "rfx.manage");
    const ctx = refs
      ? await authorize(client, current, refs)
      : { actor: current, instituteId: current.institute_id };
    const result = await work(client, ctx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function audit(
  client,
  ctx,
  action,
  entityId,
  beforeData,
  afterData,
  entityType = "rfx_event",
) {
  return writeAuditEvent({
    client,
    entityType,
    entityId,
    action,
    actorUserId: ctx.actor.id,
    instituteId: ctx.instituteId,
    requestId: ctx.requestId,
    beforeData,
    afterData,
  });
}
async function assertActiveSourcing(client, ctx) {
  const {
    ELIGIBLE_REQUEST_STATES,
  } = require("./procurementPerformance/procurementCaseService");
  if (
    !ELIGIBLE_REQUEST_STATES.has(
      String(ctx.request?.status || "")
        .trim()
        .toUpperCase(),
    )
  )
    throw finance.fail(
      409,
      "Request must be approved and active for sourcing",
      "RFX_REQUEST_STATE_BLOCKED",
    );
  const pending = await client.query(
    "SELECT id FROM approvals WHERE request_id=$1 AND NOT COALESCE(is_superseded,false) AND LOWER(TRIM(COALESCE(status,'Pending'))) NOT IN ('approved','skipped','superseded') LIMIT 1 FOR SHARE",
    [ctx.requestId],
  );
  if (pending.rowCount)
    throw finance.fail(
      409,
      "Request has unresolved approvals",
      "RFX_REQUEST_APPROVAL_PENDING",
    );
}
// The canonical award service also guards direct callers and idempotent returns.
async function authorizeAward(tx, actor, item, supplier, input) {
  const ctx = await authorize(tx.client, actor, {
    itemId: item.id,
    supplierId: supplier.id,
  });
  await assertActiveSourcing(tx.client, ctx);
  const actual = (
    await tx.client.query(
      "SELECT * FROM requested_items WHERE id=$1 FOR SHARE",
      [item.id],
    )
  ).rows[0];
  if (
    !actual ||
    !equal(actual.request_id, ctx.requestId) ||
    (item.request_id != null && !equal(item.request_id, actual.request_id))
  )
    throw missing();
  if (
    [
      "rejected",
      "cancelled",
      "canceled",
      "available in stock",
      "available_in_stock",
    ].includes(
      String(actual.approval_status || "")
        .trim()
        .toLowerCase(),
    )
  )
    throw finance.fail(
      409,
      "Requested item is not approved for sourcing",
      "RFX_ITEM_NOT_APPROVED",
    );
  const { compareDecimal } = require("./purchaseOrderTotalsService");
  if (
    ["QUOTATION", "RFX_RESPONSE"].includes(
      String(input.source_type).toUpperCase(),
    )
  ) {
    let line = (
      await tx.client.query("SELECT * FROM rfx_response_items WHERE id=$1", [
        finance.id(input.source_id),
      ])
    ).rows[0];
    let response;
    if (line && String(input.source_type).toUpperCase() === "QUOTATION") {
      response = (
        await tx.client.query("SELECT * FROM rfx_responses WHERE id=$1", [
          line.rfx_response_id,
        ])
      ).rows[0];
    } else {
      line = null;
      response = (
        await tx.client.query("SELECT * FROM rfx_responses WHERE id=$1", [
          input.source_id,
        ])
      ).rows[0];
    }
    if (!response) throw missing();
    const source = await authorize(tx.client, ctx.actor, {
      requestId: ctx.requestId,
      eventId: response.rfx_id,
      responseId: response.id,
    });
    if (
      !equal(source.response.supplier_id, supplier.id) ||
      !["submitted", "evaluated", "awarded", "po_created"].includes(
        String(source.response.status).toLowerCase().replace(/ /g, "_"),
      ) ||
      String(source.event.status).toLowerCase() === "cancelled"
    )
      throw missing();
    let terms;
    if (line) {
      line = (
        await tx.client.query(
          "SELECT * FROM rfx_response_items WHERE id=$1 FOR SHARE",
          [line.id],
        )
      ).rows[0];
      if (
        !equal(line.requested_item_id, actual.id) ||
        !equal(line.rfx_response_id, source.response.id)
      )
        throw missing();
      terms = {
        quantity: line.quoted_quantity,
        unitPrice: line.unit_price,
        currency: line.currency,
      };
      if (
        !equal(line.approved_product_id || 0, input.approved_product_id || 0) ||
        !equal(
          line.supplier_catalog_item_id || 0,
          input.supplier_catalog_item_id || 0,
        )
      )
        throw missing();
    } else {
      const lines = await tx.client.query(
        "SELECT id FROM rfx_response_items WHERE rfx_response_id=$1",
        [response.id],
      );
      if (lines.rowCount) throw missing();
      const items = (
        await tx.client.query(
          "SELECT * FROM requested_items WHERE request_id=$1 ORDER BY id FOR SHARE",
          [ctx.requestId],
        )
      ).rows;
      terms = require("./rfxAwardPricingService").priceAggregateRfxResponse({
        bidAmount: source.response.bid_amount,
        requestItems: items,
        currency: "USD",
      })[0];
    }
    if (
      compareDecimal(input.unit_price, terms.unitPrice) !== 0 ||
      String(input.currency).toUpperCase() !==
        String(terms.currency).toUpperCase() ||
      compareDecimal(input.awarded_quantity, terms.quantity) > 0
    )
      throw finance.fail(
        409,
        "Award terms differ from the source quotation",
        "RFX_AWARD_TERMS_MISMATCH",
      );
  }
  await assertProductScope(
    tx.client,
    input.approved_product_id,
    ctx.instituteId,
  );
  return ctx;
}
module.exports = {
  awardSourcePredicate,
  assertAwardOwnership,
  assertActiveSourcing,
  authorizeAward,
  authorize,
  transaction,
  resolveSupplier,
  assertSupplier,
  assertProductScope,
  eventPredicate,
  responsePredicate,
  audit,
  missing,
};
