"use strict";
const {
  canManage,
  error,
  text,
} = require("./preprocurementTechnicalReviewModel");
const reviewerScope = require("./technicalReviewerScope");
const { userHasPermission } = require("../utils/permissionService");

// A read model over the existing owners. This module never creates inspections,
// changes request status, posts stock or grants an unassigned reviewer access.
function createTechnicalWorklistService(database) {
  return async (actor, input = {}) => {
    if (
      !actor?.id ||
      !Number.isInteger(Number(actor.institute_id)) ||
      Number(actor.institute_id) < 1
    )
      throw error(403, "An institute account is required");
    const page = Number(input.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
      throw error(400, "Invalid worklist page");
    const choices = {
      type: ["PRE_PROCUREMENT", "DELIVERY_INSPECTION", "LEGACY_INSPECTION"],
      status: ["PENDING", "IN_PROGRESS", "ON_HOLD", "COMPLETED"],
      tab: ["pending", "in_progress", "history"],
    };
    for (const [key, values] of Object.entries(choices))
      if (input[key] && !values.includes(input[key]))
        throw error(400, `Invalid ${key} filter`);
    for (const key of ["from", "to"])
      if (
        input[key] &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(input[key]) ||
          Number.isNaN(Date.parse(input[key])) ||
          new Date(input[key]).toISOString().slice(0, 10) !== input[key])
      )
        throw error(400, "Use valid filter dates");
    if (input.from && input.to && input.from > input.to)
      throw error(400, "From date must not be after To date");
    if (input.department && !/^\d+$/.test(String(input.department)))
      throw error(400, "Invalid department filter");
    const available =
      (
        await database.query(`SELECT
      to_regclass('public.preprocurement_technical_reviews') IS NOT NULL AND to_regclass('public.preprocurement_technical_review_assignments') IS NOT NULL AS reviews,
      to_regclass('public.technical_inspections') IS NOT NULL AS legacy, to_regclass('public.delivery_inspection_tasks') IS NOT NULL AS delivery`)
      ).rows[0] || {};
    const sources = [],
      warnings = [];
    if (available.reviews)
      sources.push(`SELECT 'PRE_PROCUREMENT'::text AS type,t.id,t.request_id,
      COALESCE(NULLIF(r.maintenance_ref_number,''),'PR-'||r.id) AS reference,
      (SELECT string_agg(p->'snapshot'->>'item_name',', ' ORDER BY p->>'item_id') FROM jsonb_array_elements(t.item_packets) p) AS item_name,
      CASE WHEN t.status<>'IN_REVIEW' THEN 'COMPLETED' WHEN EXISTS(SELECT 1 FROM preprocurement_technical_review_assignments held WHERE held.review_id=t.id AND held.status IN ('CONDITIONAL','CLARIFICATION')) THEN 'ON_HOLD' WHEN EXISTS(SELECT 1 FROM preprocurement_technical_review_assignments progress WHERE progress.review_id=t.id AND progress.status<>'PENDING') THEN 'IN_PROGRESS' ELSE 'PENDING' END AS status,
      t.status AS decision,t.created_at,t.requesting_department_id AS department_id,d.name AS requesting_department,
      (SELECT string_agg(DISTINCT ad.name,', ' ORDER BY ad.name) FROM preprocurement_technical_review_assignments a JOIN departments ad ON ad.id=a.department_id WHERE a.review_id=t.id) AS assigned_department,
      (SELECT jsonb_agg(DISTINCT a.department_id) FROM preprocurement_technical_review_assignments a WHERE a.review_id=t.id) AS assigned_department_ids,
      t.status='IN_REVIEW' AND (EXISTS(SELECT 1 FROM preprocurement_technical_review_assignments own WHERE own.review_id=t.id AND own.reviewer_id=$2 AND own.status IN ('PENDING','IN_PROGRESS')) OR ($3 AND NOT EXISTS(SELECT 1 FROM preprocurement_technical_review_assignments waiting WHERE waiting.review_id=t.id AND waiting.status<>'APPROVED') AND NOT EXISTS(SELECT 1 FROM preprocurement_technical_review_assignments self WHERE self.review_id=t.id AND self.reviewer_id=$2))) AS awaiting_me
      FROM preprocurement_technical_reviews t JOIN requests r ON r.id=t.request_id AND r.institute_id=t.institute_id JOIN departments d ON d.id=t.requesting_department_id AND d.institute_id=t.institute_id
      WHERE t.institute_id=$1 AND ($3 OR EXISTS(SELECT 1 FROM preprocurement_technical_review_assignments own JOIN users u ON u.id=own.reviewer_id WHERE own.review_id=t.id AND own.reviewer_id=$2 AND u.is_active IS TRUE AND u.institute_id=$1 AND ${reviewerScope("u", "own.department_id", "$1")}))`);
    else
      warnings.push(
        "Pre-procurement reviews require the existing SQL 049 schema.",
      );
    if (
      available.legacy &&
      (actor.hasPermission?.("technical-inspections.manage") ||
        userHasPermission(actor, "technical-inspections.manage"))
    )
      sources.push(`SELECT 'LEGACY_INSPECTION'::text AS type,i.id,i.request_id,
      CASE WHEN i.request_id IS NULL THEN 'TI-'||i.id ELSE COALESCE(NULLIF(r.maintenance_ref_number,''),'PR-'||r.id) END AS reference,
      i.item_name,CASE WHEN lower(COALESCE(i.acceptance_status,'pending')) IN ('passed','failed') THEN 'COMPLETED' ELSE 'PENDING' END AS status,
      COALESCE(i.acceptance_status,'pending') AS decision,i.created_at,r.department_id,d.name AS requesting_department,
      'Historical record — no task assignment'::text AS assigned_department,'[]'::jsonb AS assigned_department_ids,false AS awaiting_me
      FROM technical_inspections i LEFT JOIN requests r ON r.id=i.request_id LEFT JOIN departments d ON d.id=r.department_id LEFT JOIN users creator ON creator.id=i.created_by
      WHERE (i.request_id IS NOT NULL AND r.institute_id=$1) OR (i.request_id IS NULL AND creator.institute_id=$1)`);
    if (available.delivery) {
      const receiving = Boolean(
        actor.hasPermission?.("procure-to-pay.receipts.manage") ||
        actor.permissions?.includes("procure-to-pay.receipts.manage"),
      );
      sources.push(`SELECT 'DELIVERY_INSPECTION'::text AS type,t.id,t.request_id,gr.receipt_number AS reference,gri.item_name,
       CASE WHEN t.status='CLOSED' THEN 'COMPLETED' WHEN t.status IN ('IN_PROGRESS','DECIDED') THEN 'IN_PROGRESS' ELSE t.status END AS status,
       CASE WHEN t.status='DECIDED' THEN 'Awaiting receiving disposition' WHEN t.status='CLOSED' AND gri.technical_rejected_quantity>0 AND gri.technical_accepted_quantity>0 THEN 'PARTIALLY_ACCEPTED' WHEN t.status='CLOSED' AND gri.technical_rejected_quantity>0 THEN 'REJECTED' ELSE COALESCE(t.pending_disposition->>'decision',t.status) END AS decision,t.created_at,t.department_id,d.name AS requesting_department,
       (SELECT string_agg(DISTINCT ad.name,', ' ORDER BY ad.name) FROM delivery_inspection_assignments a JOIN departments ad ON ad.id=a.department_id WHERE a.task_id=t.id) AS assigned_department,
       (SELECT jsonb_agg(DISTINCT a.department_id) FROM delivery_inspection_assignments a WHERE a.task_id=t.id) AS assigned_department_ids,
       ((t.status IN ('PENDING','IN_PROGRESS') AND EXISTS(SELECT 1 FROM delivery_inspection_assignments a WHERE a.task_id=t.id AND a.reviewer_id=$2 AND a.opinion IS NULL)) OR (t.status='DECIDED' AND ${receiving}) OR (t.status IN ('PENDING','IN_PROGRESS') AND $3 AND NOT EXISTS(SELECT 1 FROM delivery_inspection_assignments a WHERE a.task_id=t.id AND (a.opinion IS NULL OR a.reviewer_id=$2)))) AS awaiting_me
       FROM delivery_inspection_tasks t JOIN goods_receipt_items gri ON gri.id=t.receipt_item_id JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id JOIN departments d ON d.id=t.department_id
       WHERE t.institute_id=$1 AND ($3 OR ${receiving} OR t.created_by=$2 OR EXISTS(SELECT 1 FROM delivery_inspection_assignments a JOIN users u ON u.id=a.reviewer_id WHERE a.task_id=t.id AND a.reviewer_id=$2 AND u.is_active AND u.institute_id=$1 AND ${reviewerScope("u", "a.department_id", "$1")}))`);
    }
    if (!sources.length)
      return {
        rows: [],
        total: 0,
        page,
        page_size: 25,
        summary: {
          awaiting_my_review: 0,
          in_progress: 0,
          on_hold: 0,
          completed: 0,
        },
        departments: [],
        can_manage: canManage(actor),
        warnings,
      };
    const params = [actor.institute_id, actor.id, canManage(actor)],
      filters = [];
    const add = (sql, value) => {
      params.push(value);
      filters.push(sql.replaceAll("?", `$${params.length}`));
    };
    if (input.search)
      add(
        "(reference ILIKE ? OR item_name ILIKE ? OR assigned_department ILIKE ?)",
        `%${text(input.search, 200)}%`,
      );
    if (input.type) add("type=?", input.type);
    if (input.status) add("status=?", input.status);
    if (input.department)
      add(
        "assigned_department_ids @> jsonb_build_array(?::integer)",
        input.department,
      );
    if (input.from)
      add(
        "created_at >= ?::date::timestamp AT TIME ZONE 'Asia/Baghdad'",
        input.from,
      );
    if (input.to)
      add(
        "created_at < (?::date+1)::timestamp AT TIME ZONE 'Asia/Baghdad'",
        input.to,
      );
    if (input.tab === "pending") filters.push("status='PENDING'");
    if (input.tab === "in_progress")
      filters.push("status IN ('IN_PROGRESS','ON_HOLD')");
    if (input.tab === "history") filters.push("status='COMPLETED'");
    params.push((page - 1) * 25);
    const result = (
      await database.query(
        `WITH actor_context AS (SELECT $1::integer AS institute_id,$2::integer AS user_id,$3::boolean AS manager), tasks AS (${sources.join(" UNION ALL ")}),
      filtered AS (SELECT * FROM tasks ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}),
      page_rows AS (SELECT * FROM filtered ORDER BY created_at DESC,type,id DESC LIMIT 25 OFFSET $${params.length})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.type,p.id DESC) FROM page_rows p),'[]'::jsonb) AS rows,
      (SELECT count(*)::integer FROM filtered) AS total,
      (SELECT jsonb_build_object('awaiting_my_review',count(*) FILTER(WHERE awaiting_me),'in_progress',count(*) FILTER(WHERE status='IN_PROGRESS'),'on_hold',count(*) FILTER(WHERE status='ON_HOLD'),'completed',count(*) FILTER(WHERE status='COMPLETED')) FROM filtered) AS summary,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name) ORDER BY d.name) FROM departments d WHERE d.institute_id=$1 AND EXISTS(SELECT 1 FROM tasks t WHERE t.assigned_department_ids @> jsonb_build_array(d.id))),'[]'::jsonb) AS departments`,
        params,
      )
    ).rows[0];
    return {
      ...result,
      page,
      page_size: 25,
      can_manage: canManage(actor),
      warnings,
    };
  };
}
module.exports = { createTechnicalWorklistService };
