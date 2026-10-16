"use strict";
const express = require("express");
const {
  createProcurementPriorityRepository,
} = require("../repositories/procurementPriorityRepository");
const {
  updateFactors,
  previewFactors,
} = require("../services/procurementPriority/recalculationService");
const { writeAuditEvent } = require("../services/auditService");
const { ensureApprovedDepartmentPriorityCoverage } = require("../services/procurementPriority/departmentPriorityCoverageService");
const router = express.Router();
const repo = createProcurementPriorityRepository();
const { createRequestPriorityRepository } = require('../repositories/requestPriorityRepository');
const requestRepo = createRequestPriorityRepository(repo);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const permit = (req, p) => req.user.requirePermission(p);
const tx = (work) => repo.transaction(work);
// Whole-request queues are explicit contracts; item assessment/group APIs remain
// available without treating an individual item as an independently ranked request.
for (const scope of ['department','institutional']) {
  const path = scope === 'department' ? '/requests/department' : '/requests/manage';
  router.get(path, wrap(async (req,res) => {
    permit(req,scope === 'department' ? 'procurement-priority.rank-department' : 'procurement-priority.manage');
    const departmentId=scope === 'department' ? req.user.department_id : null;
    const data=await tx(async client => {
      if (scope === 'department') await ensureApprovedDepartmentPriorityCoverage({client,instituteId:req.user.institute_id,departmentId,actorId:req.user.id});
      return requestRepo.read({client,instituteId:req.user.institute_id,departmentId,scope});
    });
    res.json({data});
  }));
  router.put(scope === 'department' ? '/requests/department/order' : '/requests/institutional-order',wrap(async (req,res) => {
    permit(req,scope === 'department' ? 'procurement-priority.rank-department' : 'procurement-priority.override');
    if (!Array.isArray(req.body?.ordered_request_ids) || !req.body.ordered_request_ids.length || !req.body.snapshots)
      return res.status(400).json({message:'ordered_request_ids and snapshots are required'});
    const data=await tx(client => requestRepo.reorder({client,instituteId:req.user.institute_id,
      departmentId:scope === 'department' ? req.user.department_id : null,scope,
      orderedRequestIds:req.body.ordered_request_ids,snapshots:req.body.snapshots,reason:req.body.reason,actorId:req.user.id}));
    res.json({data});
  }));
}
// Prevent an older client from silently splitting a saved whole-request order.
const requestOrderRequired = (_req,res) => res.status(409).json({code:'REQUEST_PRIORITY_CLIENT_UPGRADE_REQUIRED',message:'Priority positions now represent whole requests. Refresh the application and use the request priority workspace.'});
router.put('/department/reorder',requestOrderRequired);
router.put('/institutional-order',requestOrderRequired);
router.put('/cases/:id/institutional-rank',requestOrderRequired);
router.get(
  "/public",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.view-public");
    res.json({ data: await repo.publicQueue(req.user.institute_id) });
  }),
);
router.get(
  "/department",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.rank-department");
    await repo.transaction((client) =>
      ensureApprovedDepartmentPriorityCoverage({ client, instituteId: req.user.institute_id,
        departmentId: req.user.department_id, actorId: req.user.id }),
    );
    res.json({
      data: await repo.departmentQueue(
        req.user.institute_id,
        req.user.department_id,
      ),
    });
  }),
);

router.get(
  "/cases/:id",
  wrap(async (req, res) => {
    const data = await repo.profile(req.params.id, req.user.institute_id);
    if (!data)
      return res.status(404).json({ message: "Priority profile not found" });
    res.json({ data });
  }),
);
router.get(
  "/cases/:id/history",
  wrap(async (req, res) =>
    res.json({
      data: await repo.history(req.params.id, req.user.institute_id),
    }),
  ),
);
router.put(
  "/cases/:id/assessment",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.manage");
    res.json({
      data: await tx((client) =>
        updateFactors({
          client,
          caseId: req.params.id,
          instituteId: req.user.institute_id,
          input: req.body || {},
          actorId: req.user.id,
        }),
      ),
    });
  }),
);
router.post(
  "/cases/:id/preview",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.manage");
    res.json({
      data: await tx((client) =>
        previewFactors({
          client,
          caseId: req.params.id,
          instituteId: req.user.institute_id,
          input: req.body || {},
        }),
      ),
    });
  }),
);

router.post(
  "/groups",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.manage-groups");
    if (!String(req.body?.public_title || "").trim())
      return res.status(400).json({ message: "Public title is required" });
    const data = await tx(async (client) => {
      const g = await client.query(
        `INSERT INTO procurement_priority_groups(institute_id,name,public_title,public_description,is_public,created_by,updated_by) VALUES($1,$2,$2,$3,$4,$5,$5) RETURNING *`,
        [
          req.user.institute_id,
          req.body.public_title.trim(),
          req.body.public_description || null,
          Boolean(req.body.is_public),
          req.user.id,
        ],
      );
      for (const id of req.body.member_case_ids || [])
        await client.query(
          `INSERT INTO procurement_priority_group_members(group_id,procurement_case_id,added_by) SELECT $1,p.procurement_case_id,$2 FROM procurement_priority_profiles p WHERE p.procurement_case_id=$3 AND p.institute_id=$4 ON CONFLICT(group_id,procurement_case_id) DO UPDATE SET removed_at=NULL,added_by=EXCLUDED.added_by,added_at=now()`,
          [g.rows[0].id, req.user.id, id, req.user.institute_id],
        );
      await writeAuditEvent({
        client,
        entityType: "procurement_priority_group",
        entityId: g.rows[0].id,
        action: "PRIORITY_GROUP_CREATED",
        actorUserId: req.user.id,
        instituteId: req.user.institute_id,
        afterData: g.rows[0],
      });
      return g.rows[0];
    });
    res.status(201).json({ data });
  }),
);
router.get(
  "/manage",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.manage");
    res.json({ data: await repo.managementQueue(req.user.institute_id) });
  }),
);

router.get(
  "/groups",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.manage-groups");
    res.json({ data: await repo.groups(req.user.institute_id) });
  }),
);
router.put(
  "/groups/:id",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.manage-groups");
    if (!String(req.body?.public_title || "").trim())
      return res.status(400).json({ message: "Public title is required" });
    const data = await tx(async (client) => {
      const g = await client.query(
        `UPDATE procurement_priority_groups SET name=$1,public_title=$1,public_description=$2,is_public=$3,updated_by=$4,updated_at=now() WHERE id=$5 AND institute_id=$6 AND status='ACTIVE' RETURNING *`,
        [
          req.body.public_title.trim(),
          req.body.public_description || null,
          Boolean(req.body.is_public),
          req.user.id,
          req.params.id,
          req.user.institute_id,
        ],
      );
      if (!g.rowCount)
        throw Object.assign(new Error("Priority group not found"), {
          statusCode: 404,
        });
      await client.query(
        `UPDATE procurement_priority_group_members SET removed_at=now() WHERE group_id=$1 AND removed_at IS NULL`,
        [req.params.id],
      );
      for (const id of req.body.member_case_ids || [])
        await client.query(
          `INSERT INTO procurement_priority_group_members(group_id,procurement_case_id,added_by) SELECT $1,p.procurement_case_id,$2 FROM procurement_priority_profiles p WHERE p.procurement_case_id=$3 AND p.institute_id=$4 ON CONFLICT(group_id,procurement_case_id) DO UPDATE SET removed_at=NULL,added_by=EXCLUDED.added_by,added_at=now()`,
          [req.params.id, req.user.id, id, req.user.institute_id],
        );
      await writeAuditEvent({
        client,
        entityType: "procurement_priority_group",
        entityId: req.params.id,
        action: "PRIORITY_GROUP_UPDATED",
        actorUserId: req.user.id,
        instituteId: req.user.institute_id,
        afterData: g.rows[0],
      });
      return g.rows[0];
    });
    res.json({ data });
  }),
);
router.put(
  "/groups/:id/archive",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.manage-groups");
    const data = await tx(async (client) => {
      const g = await client.query(
        `UPDATE procurement_priority_groups SET status='CLOSED',updated_by=$1,updated_at=now() WHERE id=$2 AND institute_id=$3 AND status='ACTIVE' RETURNING *`,
        [req.user.id, req.params.id, req.user.institute_id],
      );
      if (!g.rowCount)
        throw Object.assign(new Error("Priority group not found"), {
          statusCode: 404,
        });
      await writeAuditEvent({
        client,
        entityType: "procurement_priority_group",
        entityId: req.params.id,
        action: "PRIORITY_GROUP_ARCHIVED",
        actorUserId: req.user.id,
        instituteId: req.user.institute_id,
        afterData: g.rows[0],
      });
      return g.rows[0];
    });
    res.json({ data });
  }),
);
module.exports = router;
