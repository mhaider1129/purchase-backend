"use strict";
const m = require("./surgicalConsignmentModel");
const { userHasPermission } = require("../utils/permissionService");
const { writeAuditEvent } = require("./auditService");
const canManage = (actor) =>
  userHasPermission(actor, "departments.manage") ||
  userHasPermission(actor, "permissions.manage");
const scope = (actor) => {
  if (!actor?.id || !Number(actor.institute_id))
    throw m.error(403, "An institute account is required");
};
const fail = (message) => m.error(409, message, "SURGICAL_ROUTING_NOT_READY");
const one = (rows, label) => {
  if (rows.length !== 1)
    throw fail(
      `Expected one active ${label}; found ${rows.length}. Review Surgical consignment setup, organization assignments and active user roles in Management.`,
    );
  return rows[0];
};
const person = (user) => ({ id: user.id, name: user.name });
function createSurgicalConsignmentRoutingService(database) {
  const installed = async (db = database) =>
    Boolean(
      (
        await db.query(
          "SELECT to_regclass('public.surgical_consignment_department_settings') IS NOT NULL AND to_regclass('public.surgical_consignment_section_nurses') IS NOT NULL AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='surgical_consignment_cases' AND column_name IN ('recommended_vendor','surgery_section_id','receiving_warehouse_id','routing_snapshot'))=4 AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='surgical_consignment_cases' AND column_name IN ('supplier_id','supplier_name','vendor_contact','agreement_reference') AND is_nullable='YES')=4 AS available",
        )
      ).rows[0]?.available,
    );
  const requireInstalled = async (db = database) => {
    if (!(await installed(db)))
      throw m.error(
        503,
        "Apply complete SQL 053 to configure surgical departments and automatic routing",
        "SURGICAL_ROUTING_SCHEMA_REQUIRED",
      );
  };
  const lock = (db) => (instituteId) =>
    db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('surgical-routing:'||$1::text,0))",
      [instituteId],
    );
  const selections = async (actor) => {
    scope(actor);
    if (!(await installed()))
      return { configured: false, departments: [], sections: [] };
    const departments = (
      await database.query(
        `SELECT d.id,d.name FROM public.surgical_consignment_department_settings s JOIN public.departments d ON d.id=s.department_id AND d.institute_id=s.institute_id WHERE s.institute_id=$1 AND s.is_enabled ORDER BY d.name`,
        [actor.institute_id],
      )
    ).rows;
    const sections = (
      await database.query(
        `SELECT x.id,x.name,x.department_id FROM public.sections x JOIN public.surgical_consignment_department_settings s ON s.department_id=x.department_id JOIN public.departments d ON d.id=s.department_id AND d.institute_id=s.institute_id WHERE s.institute_id=$1 AND s.is_enabled ORDER BY x.name`,
        [actor.institute_id],
      )
    ).rows;
    return { configured: true, departments, sections };
  };
  const resolve = async (
    actor,
    departmentId,
    sectionId,
    db = database,
    { serialize = false } = {},
  ) => {
    scope(actor);
    await requireInstalled(db);
    if (serialize) await lock(db)(actor.institute_id);
    departmentId = m.id(departmentId);
    sectionId = sectionId ? m.id(sectionId) : null;
    const setting = (
      await db.query(
        `SELECT s.*,d.name AS department_name,w.name AS warehouse_name,w.is_active AS warehouse_active,w.institute_id AS warehouse_institute_id FROM public.surgical_consignment_department_settings s JOIN public.departments d ON d.id=s.department_id AND d.institute_id=s.institute_id LEFT JOIN public.warehouses w ON w.id=s.warehouse_id WHERE s.institute_id=$1 AND s.department_id=$2 AND s.is_enabled`,
        [actor.institute_id, departmentId],
      )
    ).rows[0];
    if (!setting)
      throw fail(
        "This department is not enabled for surgical consignments. Configure eligible surgical departments in Management.",
      );
    let section = null;
    if (sectionId) {
      section = (
        await db.query(
          "SELECT id,name FROM public.sections WHERE id=$1 AND department_id=$2",
          [sectionId, departmentId],
        )
      ).rows[0];
      if (!section)
        throw m.error(
          403,
          "Surgery section does not belong to the selected department",
        );
    }
    const override = sectionId
      ? (
          await db.query(
            "SELECT nurse_id FROM public.surgical_consignment_section_nurses WHERE institute_id=$1 AND department_id=$2 AND section_id=$3",
            [actor.institute_id, departmentId, sectionId],
          )
        ).rows[0]
      : null;
    const users = (
      await db.query(
        `SELECT u.id,u.name,u.role,u.department_id,u.warehouse_id,EXISTS(
    SELECT 1 FROM public.organization_positions p JOIN public.organization_units ou ON ou.id=p.organization_unit_id
    WHERE p.user_id=u.id AND ou.institute_id=$1 AND ou.department_id=$2 AND ou.is_active IS TRUE
      AND p.position_type='DEPARTMENT_HEAD' AND p.is_active IS TRUE
      AND (p.effective_from IS NULL OR p.effective_from<=$3::date) AND (p.effective_to IS NULL OR p.effective_to>=$3::date)
   ) AS structural_head FROM public.users u WHERE u.institute_id=$1 AND u.is_active IS TRUE`,
        [actor.institute_id, departmentId, m.today()],
      )
    ).rows;
    const surgeon = one(
      users.filter((u) => String(u.id) === String(actor.id)),
      "submitting surgeon",
    );
    const nurse = one(
      users.filter(
        (u) => String(u.id) === String(override?.nurse_id || setting.nurse_id),
      ),
      "responsible nurse",
    );
    if (
      !setting.warehouse_active ||
      String(setting.warehouse_institute_id) !== String(actor.institute_id)
    )
      throw fail(
        "The receiving warehouse must be active in this institute. Review Surgical consignment setup in Management.",
      );
    const receivers = users.filter(
      (u) =>
        String(u.warehouse_id) === String(setting.warehouse_id) &&
        ["warehousekeeper", "warehousemanager"].includes(m.role(u)),
    );
    const receiver = one(
      setting.receiver_id
        ? receivers.filter((u) => String(u.id) === String(setting.receiver_id))
        : receivers,
      "responsible warehouse receiver",
    );
    const structural = users.filter((u) => u.structural_head);
    const manager = one(
      structural.length
        ? structural
        : users.filter(
            (u) =>
              m.role(u) === "hod" && String(u.department_id) === departmentId,
          ),
      "surgical department HOD",
    );
    const cmo = one(
      users.filter((u) => m.role(u) === "cmo"),
      "CMO",
    );
    const scm = one(
      users.filter((u) => m.role(u) === "scm"),
      "SCM",
    );
    if (new Set([surgeon.id, nurse.id, receiver.id].map(String)).size !== 3)
      throw fail(
        "The surgeon, nurse and receiver must be different accounts. Review the configured responsibilities.",
      );
    if (
      new Set([manager.id, cmo.id, scm.id].map(String)).size !== 3 ||
      [manager, cmo, scm].some((u) => String(u.id) === String(surgeon.id))
    )
      throw fail(
        "Independent HOD, CMO and SCM authorizers are required; the submitting surgeon cannot authorize their own request.",
      );
    return {
      surgeon: person(surgeon),
      nurse: person(nurse),
      receiver: person(receiver),
      manager: person(manager),
      cmo: person(cmo),
      scm: person(scm),
      department: { id: setting.department_id, name: setting.department_name },
      section,
      warehouse: { id: setting.warehouse_id, name: setting.warehouse_name },
      setting_version: String(setting.row_version),
      nurse_source: override ? "SECTION" : "DEPARTMENT",
    };
  };
  const management = async (actor, reader = database) => {
    scope(actor);
    if (!canManage(actor))
      throw m.error(403, "Department management permission is required");
    const configured = await installed(reader);
    const departments = (
      await reader.query(
        "SELECT id,name FROM public.departments WHERE institute_id=$1 ORDER BY name",
        [actor.institute_id],
      )
    ).rows;
    const sections = (
      await reader.query(
        "SELECT s.id,s.name,s.department_id FROM public.sections s JOIN public.departments d ON d.id=s.department_id WHERE d.institute_id=$1 ORDER BY s.name",
        [actor.institute_id],
      )
    ).rows;
    const users = (
      await reader.query(
        "SELECT id,name,role,department_id,warehouse_id FROM public.users WHERE institute_id=$1 AND is_active IS TRUE ORDER BY name",
        [actor.institute_id],
      )
    ).rows;
    const warehouses = (
      await reader.query(
        "SELECT id,name FROM public.warehouses WHERE institute_id=$1 AND is_active IS TRUE ORDER BY name",
        [actor.institute_id],
      )
    ).rows;
    const settings = configured
      ? (
          await reader.query(
            `SELECT s.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('section_id',n.section_id,'nurse_id',n.nurse_id) ORDER BY n.section_id) FROM public.surgical_consignment_section_nurses n WHERE n.institute_id=s.institute_id AND n.department_id=s.department_id),'[]'::jsonb) AS section_nurses FROM public.surgical_consignment_department_settings s WHERE s.institute_id=$1 ORDER BY s.department_id`,
            [actor.institute_id],
          )
        ).rows
      : [];
    return { configured, departments, sections, users, warehouses, settings };
  };
  const save = async (actor, input) => {
    scope(actor);
    if (!canManage(actor))
      throw m.error(403, "Department management permission is required");
    const db = await database.connect();
    try {
      await db.query("BEGIN");
      await requireInstalled(db);
      await lock(db)(actor.institute_id);
      const departmentId = m.id(input.department_id),
        reason = m.text(input.reason, "Setup change reason", 2000);
      if (typeof input.is_enabled !== "boolean")
        throw m.error(
          400,
          "Choose whether this is an eligible surgical department",
        );
      if (
        !(
          await db.query(
            "SELECT id FROM public.departments WHERE id=$1 AND institute_id=$2",
            [departmentId, actor.institute_id],
          )
        ).rows.length
      )
        throw m.error(403, "Department is outside your institute");
      const before = (
        await db.query(
          "SELECT * FROM public.surgical_consignment_department_settings WHERE institute_id=$1 AND department_id=$2",
          [actor.institute_id, departmentId],
        )
      ).rows[0];
      if (String(input.row_version) !== String(before?.row_version || 0))
        throw m.error(
          409,
          "Surgical department setup changed. Reload before saving.",
          "SURGICAL_SETTINGS_VERSION_CONFLICT",
        );
      if (before)
        before.section_nurses = (
          await db.query(
            "SELECT section_id,nurse_id FROM public.surgical_consignment_section_nurses WHERE institute_id=$1 AND department_id=$2 ORDER BY section_id",
            [actor.institute_id, departmentId],
          )
        ).rows;
      const nurseId = input.nurse_id ? m.id(input.nurse_id) : null,
        warehouseId = input.warehouse_id ? m.id(input.warehouse_id) : null,
        receiverId = input.receiver_id ? m.id(input.receiver_id) : null;
      if (input.is_enabled && (!nurseId || !warehouseId))
        throw m.error(
          400,
          "An enabled surgical department needs a responsible nurse and receiving warehouse",
        );
      const overrides = input.section_nurses || [];
      if (
        !Array.isArray(overrides) ||
        overrides.length > 200 ||
        new Set(overrides.map((o) => String(o.section_id))).size !==
          overrides.length
      )
        throw m.error(400, "Use one nurse override per section");
      const staff = (
        await db.query(
          "SELECT id,role,warehouse_id FROM public.users WHERE institute_id=$1 AND is_active IS TRUE",
          [actor.institute_id],
        )
      ).rows;
      for (const id of [
        nurseId,
        ...overrides.map((o) => m.id(o.nurse_id)),
      ].filter(Boolean))
        if (!staff.some((u) => String(u.id) === id))
          throw m.error(
            403,
            "Responsible nurse must be an active account in this institute",
          );
      if (
        warehouseId &&
        !(
          await db.query(
            "SELECT id FROM public.warehouses WHERE id=$1 AND institute_id=$2 AND is_active IS TRUE",
            [warehouseId, actor.institute_id],
          )
        ).rows.length
      )
        throw m.error(
          403,
          "Receiving warehouse is outside this institute or inactive",
        );
      if (
        receiverId &&
        !staff.some(
          (u) =>
            String(u.id) === receiverId &&
            String(u.warehouse_id) === warehouseId &&
            ["warehousekeeper", "warehousemanager"].includes(m.role(u)),
        )
      )
        throw m.error(
          403,
          "The responsible receiver must be an active warehouse manager/keeper assigned to the receiving warehouse",
        );
      for (const o of overrides)
        if (
          !(
            await db.query(
              "SELECT id FROM public.sections WHERE id=$1 AND department_id=$2",
              [m.id(o.section_id), departmentId],
            )
          ).rows.length
        )
          throw m.error(
            403,
            "Nurse override section does not belong to this department",
          );
      const saved = (
        await db.query(
          `INSERT INTO public.surgical_consignment_department_settings(institute_id,department_id,is_enabled,nurse_id,warehouse_id,receiver_id,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(institute_id,department_id) DO UPDATE SET is_enabled=EXCLUDED.is_enabled,nurse_id=EXCLUDED.nurse_id,warehouse_id=EXCLUDED.warehouse_id,receiver_id=EXCLUDED.receiver_id,row_version=surgical_consignment_department_settings.row_version+1,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
          [
            actor.institute_id,
            departmentId,
            input.is_enabled,
            nurseId,
            warehouseId,
            receiverId,
            actor.id,
          ],
        )
      ).rows[0];
      await db.query(
        "DELETE FROM public.surgical_consignment_section_nurses WHERE institute_id=$1 AND department_id=$2",
        [actor.institute_id, departmentId],
      );
      for (const o of overrides)
        await db.query(
          "INSERT INTO public.surgical_consignment_section_nurses(institute_id,department_id,section_id,nurse_id) VALUES($1,$2,$3,$4)",
          [
            actor.institute_id,
            departmentId,
            m.id(o.section_id),
            m.id(o.nurse_id),
          ],
        );
      await writeAuditEvent({
        client: db,
        entityType: "surgical_consignment_department",
        entityId: departmentId,
        instituteId: actor.institute_id,
        actorUserId: actor.id,
        action: "SURGICAL_CONSIGNMENT_ROUTING_CONFIGURED",
        reason,
        beforeData: before || null,
        afterData: { ...saved, section_nurses: overrides },
      });
      const result = await management(actor, db);
      await db.query("COMMIT");
      return result;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  };
  return { installed, requireInstalled, selections, resolve, management, save };
}
module.exports = { createSurgicalConsignmentRoutingService, canManage };
