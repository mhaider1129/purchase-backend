"use strict";
const { error, fingerprint } = require("./preprocurementTechnicalReviewModel");
const QUOTATION_FINGERPRINT_VERSION = 2;
const { compareDecimal } = require('./purchaseOrderTotalsService');
// Stable JSON ordering is required for nested response_data from JSONB. Do not
// alter the legacy fingerprint implementation used by existing approvals.
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object' && !(value instanceof Date))
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stable(value[key])]),
    );
  return value;
};
const quoteContent = quote => Object.fromEntries(
  Object.entries(quote).filter(([key]) =>
    !['response_status', 'created_at', 'updated_at'].includes(key)),
);
const quotationUsable = quote =>
  ['submitted', 'evaluated', 'awarded', 'po_created'].includes(
    String(quote.response_status || '').trim().toLowerCase().replace(/\s+/g, '_'),
  );
const reviewRequired = () => error(409,
  'Historical quotation approval cannot be verified. Send the current proposal for a new technical review.',
  'TECHNICAL_PROPOSAL_REVIEW_REQUIRED');
async function quotationSnapshot(db, quote, attachmentIds = []) {
  let catalog = null;
  if (quote.supplier_catalog_item_id) {
    const row = (await db.query('SELECT to_jsonb(c) AS catalog FROM supplier_catalog_items c WHERE id=$1 FOR SHARE', [quote.supplier_catalog_item_id])).rows[0]?.catalog;
    if (!row) throw error(409, 'Quoted catalog identity is unavailable; review the proposal again', 'TECHNICAL_PROPOSAL_CHANGED');
    catalog = Object.fromEntries(['id','supplier_id','approved_product_id','purchasing_uom_id','conversion_factor'].map(key => [key, row[key] ?? null]));
  }
  const ids = [...new Set(attachmentIds.map(String))].sort();
  const attachments = ids.length ? (await db.query(
    'SELECT to_jsonb(a) AS attachment FROM attachments a WHERE a.id=ANY($1::integer[]) AND a.request_id=$2 FOR SHARE OF a',
    [ids, quote.response_request_id],
  )).rows.map(row => row.attachment).sort((a,b) => String(a.id).localeCompare(String(b.id))) : [];
  if (attachments.length !== ids.length) throw error(409, 'Technical evidence changed or is unavailable; review the proposal again', 'TECHNICAL_PROPOSAL_CHANGED');
  return stable({ version: QUOTATION_FINGERPRINT_VERSION, quotation: quoteContent(quote), catalog, attachments });
}
async function prepare(db, actor, evidence, itemId) {
  let quotation;
  if (
    evidence.supplier_id ||
    evidence.approved_product_id ||
    evidence.quotation_item_id
  )
    await require("./technicalProposalDirectory").requireSchema(db);
  if (evidence.quotation_item_id) {
    // Lock the immutable line, not the mutable RFx header: the award controller
    // already locks that header before taking the technical-review shared lock.
    const quote = (
      await db.query(
        `SELECT q.*,rr.supplier_id,rr.status AS response_status,rr.notes AS response_notes,rr.response_data,rr.bid_amount AS response_bid_amount,rr.request_id AS response_request_id FROM rfx_response_items q JOIN rfx_responses rr ON rr.id=q.rfx_response_id JOIN requested_items ri ON ri.id=q.requested_item_id JOIN requests r ON r.id=ri.request_id WHERE q.id=$1 AND q.requested_item_id=$2 AND rr.request_id=r.id AND r.institute_id=$3 FOR SHARE OF q`,
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
    if (evidence.approved_product_id && String(quote.approved_product_id || '') !== String(evidence.approved_product_id))
      throw error(400, 'Quotation must use the selected approved product');
    if (quote.approved_product_id) evidence.approved_product_id = String(quote.approved_product_id);
    if (!quotationUsable(quote))
      throw error(409, 'Quotation is not available for technical approval', 'TECHNICAL_PROPOSAL_CHANGED');
    quotation = quote;
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
        "SELECT to_jsonb(p)-'updated_at'-'updated_by' AS product,m.manufacturer_name AS manufacturer FROM approved_products p LEFT JOIN item_manufacturers m ON m.id=p.manufacturer_id WHERE p.id=$1 AND (p.institute_id=$2 OR p.institute_id IS NULL) AND p.is_active",
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
  if (quotation) {
    evidence.quotation_fingerprint_version = QUOTATION_FINGERPRINT_VERSION;
    evidence.quotation_snapshot = await quotationSnapshot(db, quotation, evidence.attachment_ids || []);
    evidence.quotation_fingerprint = fingerprint(evidence.quotation_snapshot);
  }
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
        "SELECT q.*,rr.supplier_id,rr.status AS response_status,rr.notes AS response_notes,rr.response_data,rr.bid_amount AS response_bid_amount,rr.request_id AS response_request_id FROM rfx_response_items q JOIN rfx_responses rr ON rr.id=q.rfx_response_id WHERE q.id=$1 FOR SHARE OF q",
        [evidence.quotation_item_id],
      )
    ).rows[0];
    const version = evidence.quotation_fingerprint_version;
    if (version == null || version === 1) {
      // Verify exactly as it was signed; never strip status from an old hash or
      // silently upgrade an already attested packet.
      if (!value || fingerprint(value) !== evidence.quotation_fingerprint) throw reviewRequired();
    } else if (version === QUOTATION_FINGERPRINT_VERSION) {
      if (value && !quotationUsable(value))
        throw error(409, 'Reviewed quotation is no longer available for procurement', 'TECHNICAL_PROPOSAL_CHANGED');
      const snapshot = value && await quotationSnapshot(db, value, evidence.attachment_ids || []);
      if (!snapshot || fingerprint(snapshot) !== evidence.quotation_fingerprint)
        throw error(409, 'The quotation or technical evidence changed after review; review the revised proposal', 'TECHNICAL_PROPOSAL_CHANGED');
    } else throw reviewRequired();
    if (value && (
      (context.unit_price != null && compareDecimal(context.unit_price, value.unit_price) !== 0) ||
      (context.currency != null && String(context.currency).toUpperCase() !== String(value.currency).toUpperCase()) ||
      (context.supplier_catalog_item_id != null && String(context.supplier_catalog_item_id) !== String(value.supplier_catalog_item_id || '')) ||
      (context.quantity != null && compareDecimal(context.quantity, value.quoted_quantity) > 0)
    )) throw error(409, 'Award/PO terms differ from the reviewed quotation', 'TECHNICAL_PROPOSAL_CHANGED');
  }
}
module.exports = { prepare, assertCurrent, QUOTATION_FINGERPRINT_VERSION };
