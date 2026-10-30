"use strict";
const { error, fingerprint } = require("./preprocurementTechnicalReviewModel");
async function prepare(db, actor, evidence, itemId) {
  if (evidence.quotation_item_id) {
    const quote = (
      await db.query(
        `SELECT q.*,rr.supplier_id,rr.status AS response_status,rr.notes AS response_notes,rr.response_data,rr.bid_amount AS response_bid_amount,rr.request_id AS response_request_id FROM rfx_response_items q JOIN rfx_responses rr ON rr.id=q.rfx_response_id JOIN requested_items ri ON ri.id=q.requested_item_id JOIN requests r ON r.id=ri.request_id WHERE q.id=$1 AND q.requested_item_id=$2 AND rr.request_id=r.id AND r.institute_id=$3`,
        [evidence.quotation_item_id, itemId, actor.institute_id],
      )
    ).rows[0];
    if (
      !quote ||
      (evidence.supplier_id &&
        String(quote.supplier_id) !== String(evidence.supplier_id))
    )
      throw error(
        400,
        "Quotation must belong to the selected item, request and supplier",
      );
    evidence.supplier_id = String(quote.supplier_id);
    evidence.quotation_fingerprint = fingerprint(quote);
  }
  if (evidence.supplier_id) {
    const supplier = (
      await db.query(
        "SELECT id,name FROM suppliers WHERE id=$1 AND (institute_id=$2 OR institute_id IS NULL) AND lower(COALESCE(status,'')) NOT IN ('inactive','suspended','blacklisted')",
        [evidence.supplier_id, actor.institute_id],
      )
    ).rows[0];
    if (!supplier)
      throw error(400, "Choose an eligible supplier for this proposal");
    evidence.supplier_name = supplier.name;
  }
  if (evidence.approved_product_id) {
    const snapshot = (
      await db.query(
        "SELECT to_jsonb(p)-'updated_at'-'updated_by' AS product,m.manufacturer_name AS manufacturer FROM approved_products p LEFT JOIN item_manufacturers m ON m.id=p.manufacturer_id WHERE p.id=$1 AND p.institute_id=$2 AND p.is_active",
        [evidence.approved_product_id, actor.institute_id],
      )
    ).rows[0];
    const product = snapshot?.product;
    if (!product)
      throw error(
        400,
        "Proposed product is outside this institute or inactive",
      );
    const requested = (
      await db.query(
        "SELECT generic_item_id FROM requested_items WHERE id=$1",
        [itemId],
      )
    ).rows[0];
    if (
      requested?.generic_item_id &&
      String(requested.generic_item_id) !== String(product.generic_item_id)
    )
      throw error(
        400,
        "Proposed product does not match the requested Generic Item",
      );
    evidence.product_fingerprint = fingerprint(product);
    evidence.proposed_product_name = product.product_name;
    evidence.manufacturer = snapshot.manufacturer || evidence.manufacturer;
    evidence.model_number =
      evidence.model_number || product.manufacturer_part_number || "";
  }
  if (
    evidence.model_number &&
    !evidence.supplier_id &&
    !evidence.approved_product_id
  )
    throw error(
      400,
      "Select the supplier identity when reviewing a specific proposed model",
    );
}
async function assertCurrent(db, evidence, context = {}) {
  for (const field of ["supplier_id", "approved_product_id"])
    if (
      evidence[field] &&
      String(context[field] || "") !== String(evidence[field])
    )
      throw error(
        409,
        "The proposed supplier or product changed after technical review; review the new proposal",
        "TECHNICAL_PROPOSAL_CHANGED",
      );
  if (evidence.product_fingerprint) {
    const value = (
      await db.query(
        "SELECT to_jsonb(p)-'updated_at'-'updated_by' AS product FROM approved_products p WHERE p.id=$1",
        [evidence.approved_product_id],
      )
    ).rows[0]?.product;
    if (!value || fingerprint(value) !== evidence.product_fingerprint)
      throw error(
        409,
        "The approved product changed after technical review",
        "TECHNICAL_PROPOSAL_CHANGED",
      );
  }
  if (evidence.quotation_item_id) {
    if (
      context.source_type !== "QUOTATION" ||
      String(context.source_id || "") !== String(evidence.quotation_item_id)
    )
      throw error(
        409,
        "Use the technically reviewed quotation or submit the new proposal for review",
        "TECHNICAL_PROPOSAL_CHANGED",
      );
    const value = (
      await db.query(
        "SELECT q.*,rr.supplier_id,rr.status AS response_status,rr.notes AS response_notes,rr.response_data,rr.bid_amount AS response_bid_amount,rr.request_id AS response_request_id FROM rfx_response_items q JOIN rfx_responses rr ON rr.id=q.rfx_response_id WHERE q.id=$1",
        [evidence.quotation_item_id],
      )
    ).rows[0];
    if (!value || fingerprint(value) !== evidence.quotation_fingerprint)
      throw error(
        409,
        "The quotation changed after technical review",
        "TECHNICAL_PROPOSAL_CHANGED",
      );
  }
}
module.exports = { prepare, assertCurrent };
