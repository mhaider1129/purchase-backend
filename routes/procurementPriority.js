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
const router = express.Router();
const repo = createProcurementPriorityRepository();
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const permit = (req, p) => req.user.requirePermission(p);
const tx = (work) => repo.transaction(work);
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
    res.json({
      data: await repo.departmentQueue(
        req.user.institute_id,
        req.user.department_id,
      ),
    });
  }),
);
router.put(
  "/department/reorder",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.rank-department");
    const ids = req.body?.ordered_case_ids;
    if (!Array.isArray(ids) || !ids.length || req.body.version == null)
      return res
        .status(400)
        .json({ message: "ordered_case_ids and version are required" });
    res.json({
      data: await repo.reorderDepartment({
        instituteId: req.user.institute_id,
        departmentId: req.user.department_id,
        orderedCaseIds: ids,
        version: req.body.version,
        actorId: req.user.id,
      }),
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
router.put(
  "/cases/:id/institutional-rank",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.override");
    if (
      !Number.isInteger(req.body?.institutional_rank) ||
      !String(req.body?.reason || "").trim()
    )
      return res
        .status(400)
        .json({ message: "Institutional rank and reason are required" });
    const data = await tx(async (client) => {
      const row = await client.query(
        `UPDATE procurement_priority_profiles SET institutional_rank=$1,institutional_override_reason=$2,row_version=row_version+1,updated_at=now() WHERE procurement_case_id=$3 AND institute_id=$4 RETURNING *`,
        [
          req.body.institutional_rank,
          req.body.reason.trim(),
          req.params.id,
          req.user.institute_id,
        ],
      );
      if (!row.rowCount)
        throw Object.assign(new Error("Priority profile not found"), {
          statusCode: 404,
        });
      await writeAuditEvent({
        client,
        entityType: "procurement_priority_profile",
        entityId: req.params.id,
        action: "INSTITUTIONAL_RANK_OVERRIDDEN",
        actorUserId: req.user.id,
        instituteId: req.user.institute_id,
        reason: req.body.reason,
        afterData: { institutional_rank: req.body.institutional_rank },
      });
      return row.rows[0];
    });
    res.json({ data });
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
router.put(
  "/institutional-order",
  wrap(async (req, res) => {
    permit(req, "procurement-priority.override");
    const entries = req.body?.entries;
    if (!Array.isArray(entries) || !entries.length)
      return res
        .status(400)
        .json({ message: "Complete institutional order is required" });
    const data = await tx(async (client) => {
      const current = await client.query(
        `SELECT p.procurement_case_id,p.system_suggested_rank FROM procurement_priority_profiles p JOIN procurement_cases pc ON pc.id=p.procurement_case_id WHERE p.institute_id=$1 AND pc.closed_at IS NULL ORDER BY p.procurement_case_id FOR UPDATE OF p,pc`,
        [req.user.institute_id],
      );
      const supplied = entries.map((e) => String(e.procurement_case_id));
      const expected = current.rows.map((e) => String(e.procurement_case_id));
      const ranks = entries.map((e) => e.institutional_rank);
      if (
        new Set(supplied).size !== supplied.length ||
        supplied.length !== expected.length ||
        supplied
          .slice()
          .sort()
          .some((v, i) => v !== expected.slice().sort()[i]) ||
        ranks.some((r) => !Number.isInteger(r) || r < 1) ||
        new Set(ranks).size !== ranks.length ||
        ranks
          .slice()
          .sort((a, b) => a - b)
          .some((r, i) => r !== i + 1)
      )
        throw Object.assign(
          new Error(
            "Complete active queue with unique contiguous ranks is required",
          ),
          { statusCode: 409 },
        );
      const differs = entries.some(
        (e) =>
          Number(
            current.rows.find(
              (x) =>
                String(x.procurement_case_id) === String(e.procurement_case_id),
            ).system_suggested_rank,
          ) !== e.institutional_rank,
      );
      if (differs && !String(req.body.reason || "").trim())
        throw Object.assign(
          new Error(
            "Override reason is required when order differs from suggested order",
          ),
          { statusCode: 400 },
        );
      for (const e of entries)
        await client.query(
          `UPDATE procurement_priority_profiles SET institutional_rank=$1,institutional_override_reason=$2,row_version=row_version+1,updated_at=now() WHERE procurement_case_id=$3 AND institute_id=$4`,
          [
            e.institutional_rank,
            differs ? req.body.reason.trim() : null,
            e.procurement_case_id,
            req.user.institute_id,
          ],
        );
      await writeAuditEvent({
        client,
        entityType: "institutional_priority_queue",
        entityId: String(req.user.institute_id),
        action: "INSTITUTIONAL_PRIORITY_REORDERED",
        actorUserId: req.user.id,
        instituteId: req.user.institute_id,
        reason: req.body.reason || null,
        afterData: { entries },
      });
      return repo.managementQueue(req.user.institute_id, client);
    });
    res.json({ data });
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