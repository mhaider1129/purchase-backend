"use strict";
const { error } = require("./preprocurementTechnicalReviewModel");
const { requireManager } = require("./technicalReviewProfiles");
async function requireSchema(db) {
  const missing = (
    await db.query(
      `SELECT required.table_name FROM (VALUES ('suppliers'),('approved_products')) required(table_name) WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=required.table_name AND c.column_name='institute_id') ORDER BY required.table_name`,
    )
  ).rows;
  if (missing.length)
    throw error(
      503,
      `Technical proposal directory is missing ${missing.map((row) => "public." + row.table_name + ".institute_id").join(", ")}. Apply the complete SQL 055 technical proposal scope compatibility patch, then reload.`,
      "TECHNICAL_PROPOSAL_SCHEMA_REQUIRED",
    );
}
async function load(db, actor) {
  requireManager(actor);
  await requireSchema(db);
  const quotations = (
    await db.query(
      "SELECT q.id,q.requested_item_id,ri.item_name,rr.supplier_id,s.name supplier_name FROM rfx_response_items q JOIN rfx_responses rr ON rr.id=q.rfx_response_id JOIN requested_items ri ON ri.id=q.requested_item_id JOIN requests r ON r.id=ri.request_id JOIN suppliers s ON s.id=rr.supplier_id WHERE r.institute_id=$1 AND rr.request_id=r.id AND (s.institute_id=$1 OR s.institute_id IS NULL) ORDER BY q.id DESC LIMIT 1000",
      [actor.institute_id],
    )
  ).rows;
  const suppliers = (
    await db.query(
      "SELECT id,name FROM suppliers WHERE (institute_id=$1 OR institute_id IS NULL) AND lower(COALESCE(status,'')) NOT IN ('inactive','suspended','blacklisted') ORDER BY name",
      [actor.institute_id],
    )
  ).rows;
  // Original Item Master tables were shared. NULL retains that ownership;
  // explicit institute ownership must never leak through this directory.
  const products = (
    await db.query(
      "SELECT id,product_name FROM approved_products WHERE (institute_id=$1 OR institute_id IS NULL) AND is_active ORDER BY product_name",
      [actor.institute_id],
    )
  ).rows;
  return { quotations, suppliers, products };
}
module.exports = { load, requireSchema };
