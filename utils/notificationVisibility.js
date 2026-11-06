"use strict";
// Current request-view authority for already-delivered, source-linked notices.
async function context(database, userId) {
  const user = (
    await database.query(
      "SELECT id,institute_id,is_active,role FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  const grants = user?.is_active
    ? await require("./permissionService").getPermissionsForUserId(
        userId,
        database,
      )
    : { permissions: [] };
  return {
    active: !!user?.is_active,
    viewAll: grants.permissions.includes("requests.view-all"),
    technicalManager:
      require("../services/preprocurementTechnicalReviewModel").canManage({
        ...user,
        permissions: grants.permissions,
      }),
    deliveryManager:
      require("../services/preprocurementTechnicalReviewModel").canManage({
        ...user,
        permissions: grants.permissions,
      }) || grants.permissions.includes("procure-to-pay.receipts.manage"),
    rfid: grants.permissions.some((p) =>
      ["rfid.view", "rfid.manage-infrastructure"].includes(p),
    ),
  };
}
const source =
  "COALESCE(CASE WHEN o.entity_type='request' THEN o.entity_id END,o.payload->>'requestId',n.metadata->>'requestId',n.metadata->>'request_id',CASE WHEN n.link ~ '^/requests/[0-9]+$' THEN split_part(n.link,'/',3) END)";
const requestId = `CASE WHEN ${source} ~ '^[0-9]{1,10}$' THEN CASE WHEN (${source})::numeric<=2147483647 THEN (${source})::integer END END`;
const deliverySource =
  "COALESCE(CASE WHEN o.entity_type='delivery_inspection' THEN o.entity_id END,n.metadata->>'delivery_inspection_id')";
const deliveryId = `CASE WHEN ${deliverySource} ~ '^[0-9]{1,10}$' THEN CASE WHEN (${deliverySource})::numeric<=2147483647 THEN (${deliverySource})::integer END END`;
const reviewerScope = require("../services/technicalReviewerScope");
const reviewSource =
  "COALESCE(CASE WHEN o.entity_type='preprocurement_technical_review' THEN o.entity_id END,n.metadata->>'technical_review_id')";
const reviewId = `CASE WHEN ${reviewSource} ~ '^[0-9]{1,10}$' THEN CASE WHEN (${reviewSource})::numeric<=2147483647 THEN (${reviewSource})::integer END END`;
const predicate = `EXISTS(SELECT 1 FROM users current_user_record WHERE current_user_record.id=n.user_id AND current_user_record.is_active AND
 (o.institute_id IS NULL OR o.institute_id=current_user_record.institute_id) AND
 CASE WHEN ${reviewSource} IS NOT NULL THEN EXISTS(SELECT 1 FROM preprocurement_technical_reviews t WHERE t.id=${reviewId} AND t.institute_id=current_user_record.institute_id AND ($5::boolean OR EXISTS(SELECT 1 FROM preprocurement_technical_review_assignments a WHERE a.review_id=t.id AND a.reviewer_id=n.user_id AND ${reviewerScope("current_user_record", "a.department_id", "t.institute_id")}))) WHEN ${deliverySource} IS NOT NULL THEN EXISTS(SELECT 1 FROM delivery_inspection_tasks t WHERE t.id=${deliveryId} AND t.institute_id=current_user_record.institute_id AND ($4::boolean OR t.created_by=n.user_id OR EXISTS(SELECT 1 FROM delivery_inspection_assignments a WHERE a.task_id=t.id AND a.reviewer_id=n.user_id AND ${reviewerScope("current_user_record", "a.department_id", "t.institute_id")}))) WHEN ${source} IS NOT NULL THEN EXISTS(SELECT 1 FROM requests r WHERE r.id=${requestId} AND r.institute_id=current_user_record.institute_id AND ($2::boolean OR r.requester_id=n.user_id OR r.assigned_to=n.user_id OR EXISTS(SELECT 1 FROM approvals a WHERE a.request_id=r.id AND a.approver_id=n.user_id) OR EXISTS(SELECT 1 FROM requested_items i WHERE i.request_id=r.id AND i.assigned_to=n.user_id)))
 WHEN lower(o.entity_type)='rfid_read' THEN $3::boolean
 ELSE n.outbox_event_id IS NULL END)`;
module.exports = { context, predicate };
