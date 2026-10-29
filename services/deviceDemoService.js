"use strict";
const m = require("./deviceDemoModel");
const { writeAuditEvent } = require("./auditService");
const { fulfilledItemSql } = require("./requestFulfillmentSql");
const { error, required, id, snapshotItem, fingerprint } = m;
const CURRENT_APPROVAL = `EXISTS(SELECT 1 FROM public.approvals a WHERE a.request_id=r.id AND a.approver_id=$2 AND a.is_active IS TRUE AND a.status IN ('Pending','On Hold') AND NOT COALESCE(a.is_superseded,false))`;
const ACTIVE_REQUEST = `lower(trim(r.status)) NOT IN ('rejected','cancelled','canceled','closed','completed','received','available in stock','available_in_stock','in stock','in_stock')`;
const COO_USERS = `SELECT DISTINCT u.id FROM public.users u WHERE u.institute_id=$1 AND u.is_active IS TRUE AND (lower(trim(u.role))='coo' OR EXISTS(SELECT 1 FROM public.roles ro JOIN public.role_permissions rp ON rp.role_id=ro.id JOIN public.permissions p ON p.id=rp.permission_id WHERE lower(trim(ro.name))=lower(trim(u.role)) AND p.code='approval-authority.coo'))`;
function createDeviceDemoService(database) {
  const scope = (actor) => {
    if (!actor?.id || !(Number(actor.institute_id) > 0))
      throw error(403, "An authenticated institute account is required");
  };
  const configured = async (client) => {
    if (
      !(
        await client.query(
          "SELECT to_regclass('public.device_demo_workspaces') IS NOT NULL AS demo_available",
        )
      ).rows[0]?.demo_available
    )
      throw error(
        503,
        "Apply SQL 050 to enable device demos",
        "DEVICE_DEMO_SCHEMA_REQUIRED",
      );
  };
  const lock = (client, itemId) =>
    client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('device-demo:'||$1::text,0))",
      [itemId],
    );
  const tx = async (work) => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await configured(client);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };
  const coordinator = (actor, w) =>
    m.isScm(actor) ||
    (m.isMedical(actor) && String(w.created_by) === String(actor.id));
  const signature = async (client, actor) =>
    (
      await client.query(
        "SELECT jsonb_build_object('user_id',id,'name',name,'role',role,'department_id',department_id,'signed_at',now()) AS signature FROM public.users WHERE id=$1 AND institute_id=$2 AND is_active IS TRUE",
        [actor.id, actor.institute_id],
      )
    ).rows[0]?.signature;
  const notify = (client, userId, title, notes, workspace) =>
    client.query(
      "INSERT INTO public.notifications(user_id,title,message,link,metadata) SELECT u.id,$2,$3,$4,$5::jsonb FROM public.users u WHERE u.id=$1 AND u.institute_id=$6 AND u.is_active IS TRUE",
      [
        userId,
        title,
        notes,
        `/device-demos?workspace=${workspace.id}`,
        JSON.stringify({
          device_demo_workspace_id: String(workspace.id),
          request_id: workspace.request_id,
        }),
        workspace.institute_id,
      ],
    );
  const evidence = async (client, w, ids = []) => {
    if (
      !Array.isArray(ids) ||
      ids.length > 20 ||
      new Set(ids.map(String)).size !== ids.length
    )
      throw error(400, "Choose up to 20 distinct request attachments");
    ids = ids.map(id);
    if (
      ids.length &&
      (
        await client.query(
          "SELECT id FROM public.attachments WHERE request_id=$1 AND id=ANY($2::int[])",
          [w.request_id, ids],
        )
      ).rows.length !== ids.length
    )
      throw error(400, "Evidence must belong to this purchase request");
    return ids;
  };
  const journal = async (
    client,
    actor,
    w,
    action,
    notes,
    demoId = null,
    attachmentIds = [],
  ) => {
    const signed = await signature(client, actor);
    if (!signed)
      throw error(403, "The account is no longer active in this institute");
    await client.query(
      "INSERT INTO public.device_demo_events(workspace_id,demo_id,action,notes,attachment_ids,actor_id,actor_snapshot) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)",
      [
        w.id,
        demoId,
        action,
        notes,
        JSON.stringify(attachmentIds),
        actor.id,
        JSON.stringify(signed),
      ],
    );
    await writeAuditEvent({
      client,
      entityType: "device_demo_workspace",
      entityId: w.id,
      requestId: w.request_id,
      instituteId: actor.institute_id,
      actorUserId: actor.id,
      action,
      reason: notes,
      metadata: { demo_id: demoId, row_version: w.row_version },
    });
  };
  const list = async (actor, search = "") => {
    scope(actor);
    await configured(database);
    return (
      await database.query(
        `SELECT w.*,r.maintenance_ref_number,ri.item_name,(SELECT count(*) FROM public.device_demo_candidates d WHERE d.workspace_id=w.id) AS demo_count FROM public.device_demo_workspaces w JOIN public.requests r ON r.id=w.request_id AND r.institute_id=w.institute_id JOIN public.requested_items ri ON ri.id=w.request_item_id WHERE w.institute_id=$1 AND ($2::boolean OR w.created_by=$3 OR EXISTS(SELECT 1 FROM public.device_demo_reviewers a JOIN public.users u ON u.id=a.reviewer_id WHERE a.workspace_id=w.id AND a.reviewer_id=$3 AND u.institute_id=$1 AND u.department_id=a.department_id AND u.is_active IS TRUE)) AND (w.title ILIKE $4 OR w.request_id::text ILIKE $4 OR COALESCE(r.maintenance_ref_number,'') ILIKE $4 OR ri.item_name ILIKE $4) ORDER BY (w.status='COO_REVIEW') DESC,w.id DESC LIMIT 100`,
        [
          actor.institute_id,
          m.isScm(actor) || m.isCoo(actor),
          actor.id,
          `%${m.text(search, 200)}%`,
        ],
      )
    ).rows;
  };
  const get = async (actor, workspaceId, client = database) => {
    scope(actor);
    await configured(client);
    const w = (
      await client.query(
        `SELECT w.*,r.status AS request_status,r.maintenance_ref_number,dep.name AS department_name FROM public.device_demo_workspaces w JOIN public.requests r ON r.id=w.request_id AND r.institute_id=w.institute_id JOIN public.departments dep ON dep.id=w.requesting_department_id AND dep.institute_id=w.institute_id WHERE w.id=$1 AND w.institute_id=$2 AND ($3::boolean OR w.created_by=$4 OR EXISTS(SELECT 1 FROM public.device_demo_reviewers a JOIN public.users u ON u.id=a.reviewer_id WHERE a.workspace_id=w.id AND a.reviewer_id=$4 AND u.institute_id=$2 AND u.department_id=a.department_id AND u.is_active IS TRUE))`,
        [
          id(workspaceId),
          actor.institute_id,
          m.isScm(actor) || m.isCoo(actor),
          actor.id,
        ],
      )
    ).rows[0];
    if (!w) throw error(404, "Demo workspace not found");
    w.reviewers = (
      await client.query(
        "SELECT a.*,u.name,u.role,d.name AS department_name FROM public.device_demo_reviewers a JOIN public.users u ON u.id=a.reviewer_id JOIN public.departments d ON d.id=a.department_id WHERE a.workspace_id=$1 ORDER BY u.name",
        [w.id],
      )
    ).rows;
    w.demos = (
      await client.query(
        "SELECT * FROM public.device_demo_candidates WHERE workspace_id=$1 ORDER BY id",
        [w.id],
      )
    ).rows;
    w.reports = (
      await client.query(
        "SELECT r.* FROM public.device_demo_reports r JOIN public.device_demo_candidates d ON d.id=r.demo_id WHERE d.workspace_id=$1 ORDER BY r.id",
        [w.id],
      )
    ).rows;
    w.selections = (
      await client.query(
        "SELECT * FROM public.device_demo_selections WHERE workspace_id=$1 ORDER BY id DESC",
        [w.id],
      )
    ).rows;
    w.events = (
      await client.query(
        "SELECT * FROM public.device_demo_events WHERE workspace_id=$1 ORDER BY id DESC",
        [w.id],
      )
    ).rows;
    const attachmentIds = [
      ...new Set(w.events.flatMap((e) => e.attachment_ids).map(String)),
    ];
    w.attachments = attachmentIds.length
      ? (
          await client.query(
            "SELECT id,file_name FROM public.attachments WHERE request_id=$1 AND id=ANY($2::int[])",
            [w.request_id, attachmentIds],
          )
        ).rows
      : [];
    return {
      ...w,
      can_coordinate: coordinator(actor, w),
      can_decide:
        m.isCoo(actor) &&
        String(w.created_by) !== String(actor.id) &&
        !w.reviewers.some((r) => String(r.reviewer_id) === String(actor.id)),
      current_user_id: actor.id,
    };
  };
  const eligible = async (actor, search = "") => {
    scope(actor);
    if (!m.initiator(actor))
      throw error(403, "SCM or medical-devices authority is required");
    return (
      await database.query(
        `SELECT ri.id,ri.request_id,ri.item_name,ri.specs,r.status,r.maintenance_ref_number,d.name AS department_name FROM public.requested_items ri JOIN public.requests r ON r.id=ri.request_id JOIN public.departments d ON d.id=r.department_id AND d.institute_id=r.institute_id WHERE r.institute_id=$1 AND ${ACTIVE_REQUEST} AND r.request_type<>'Warehouse Supply' AND (${CURRENT_APPROVAL} OR ($3::boolean AND lower(trim(r.status)) IN ('approved','partially procured','partially_procured'))) AND COALESCE(ri.purchased_quantity,0)=0 AND NOT ${fulfilledItemSql("ri")} AND lower(trim(COALESCE(ri.approval_status,'')))<>'rejected' AND lower(trim(COALESCE(ri.procurement_status,''))) NOT IN ('cancelled','canceled','not_procured','unable_to_procure') AND NOT EXISTS(SELECT 1 FROM public.device_demo_workspaces w WHERE w.request_item_id=ri.id AND w.status<>'CANCELLED') AND (r.id::text ILIKE $4 OR ri.item_name ILIKE $4 OR COALESCE(r.maintenance_ref_number,'') ILIKE $4) ORDER BY r.created_at DESC,ri.id LIMIT 100`,
        [
          actor.institute_id,
          actor.id,
          m.isScm(actor),
          `%${m.text(search, 200)}%`,
        ],
      )
    ).rows;
  };
  const directory = async (actor) => {
    scope(actor);
    if (!m.initiator(actor))
      throw error(403, "Demo coordination authority required");
    return (
      await database.query(
        "SELECT u.id,u.name,u.role,u.department_id,d.name AS department_name FROM public.users u JOIN public.departments d ON d.id=u.department_id AND d.institute_id=u.institute_id WHERE u.institute_id=$1 AND u.is_active IS TRUE AND lower(trim(u.role))<>'coo' ORDER BY d.name,u.name",
        [actor.institute_id],
      )
    ).rows;
  };
  const noDownstream = async (client, w) => {
    const result = (
      await client.query(
        `SELECT EXISTS(SELECT 1 FROM public.procurement_awards WHERE request_item_id=$1 AND status='ACTIVE') OR EXISTS(SELECT 1 FROM public.purchase_order_items WHERE requested_item_id=$1) OR EXISTS(SELECT 1 FROM public.procurement_item_events WHERE requested_item_id=$1) OR EXISTS(SELECT 1 FROM public.requested_items WHERE id=$1 AND COALESCE(purchased_quantity,0)>0) OR EXISTS(SELECT 1 FROM public.requested_item_financials WHERE requested_item_id=$1 AND (COALESCE(committed_cost,0)>0 OR COALESCE(paid_cost,0)>0 OR NULLIF(trim(po_number),'') IS NOT NULL OR NULLIF(trim(invoice_number),'') IS NOT NULL)) AS started`,
        [w.request_item_id],
      )
    ).rows[0];
    if (result?.started)
      throw error(
        409,
        "Procurement has already started for this device; use the governed cancellation process",
      );
  };
  const fresh = async (client, w) => {
    const row = (
      await client.query(
        `SELECT ri.*,r.department_id,r.status AS request_status FROM public.requested_items ri JOIN public.requests r ON r.id=ri.request_id WHERE ri.id=$1 AND ri.request_id=$2 AND r.institute_id=$3 AND ${ACTIVE_REQUEST} AND COALESCE(ri.purchased_quantity,0)=0 AND NOT ${fulfilledItemSql("ri")} AND lower(trim(COALESCE(ri.approval_status,'')))<>'rejected' AND lower(trim(COALESCE(ri.procurement_status,''))) NOT IN ('cancelled','canceled','not_procured','unable_to_procure')`,
        [w.request_item_id, w.request_id, w.institute_id],
      )
    ).rows[0];
    if (
      !row ||
      String(row.department_id) !== String(w.requesting_department_id) ||
      fingerprint(snapshotItem(row)) !== w.item_fingerprint
    )
      throw error(
        409,
        "The request or device requirement changed; cancel and open a fresh demo workspace",
        "DEVICE_DEMO_STALE",
      );
    return row;
  };
  const create = async (actor, input) => {
    scope(actor);
    if (!m.initiator(actor) || m.isCoo(actor))
      throw error(
        403,
        "SCM or medical-devices authority is required to open a demo",
      );
    const itemId = id(input.request_item_id),
      definition = m.criteria(input.criteria),
      reviewerIds = Array.isArray(input.reviewer_ids)
        ? input.reviewer_ids.map(id)
        : [];
    if (
      !reviewerIds.length ||
      reviewerIds.length > 20 ||
      new Set(reviewerIds).size !== reviewerIds.length
    )
      throw error(400, "Select 1–20 distinct departmental evaluators");
    const title = required(input.title, "Workspace title", 250),
      objectives = required(input.objectives, "Demo objectives"),
      key = required(input.submission_key, "Submission key", 128),
      payload = fingerprint({
        itemId,
        definition,
        reviewerIds: [...reviewerIds].sort(),
        title,
        objectives,
      });
    return tx(async (client) => {
      await lock(client, itemId);
      const prior = (
        await client.query(
          "SELECT id,payload_fingerprint FROM public.device_demo_workspaces WHERE institute_id=$1 AND submission_key=$2",
          [actor.institute_id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_fingerprint !== payload)
          throw error(
            409,
            "Submission key was already used for different details",
          );
        return get(actor, prior.id, client);
      }
      const row = (
        await client.query(
          `SELECT ri.*,r.institute_id,r.department_id FROM public.requested_items ri JOIN public.requests r ON r.id=ri.request_id JOIN public.departments dep ON dep.id=r.department_id AND dep.institute_id=r.institute_id WHERE ri.id=$4 AND r.institute_id=$1 AND ${ACTIVE_REQUEST} AND r.request_type<>'Warehouse Supply' AND (${CURRENT_APPROVAL} OR ($3::boolean AND lower(trim(r.status)) IN ('approved','partially procured','partially_procured'))) AND COALESCE(ri.purchased_quantity,0)=0 AND NOT ${fulfilledItemSql("ri")} AND lower(trim(COALESCE(ri.approval_status,'')))<>'rejected' AND lower(trim(COALESCE(ri.procurement_status,''))) NOT IN ('cancelled','canceled','not_procured','unable_to_procure')`,
          [actor.institute_id, actor.id, m.isScm(actor), itemId],
        )
      ).rows[0];
      if (!row)
        throw error(
          409,
          "Open a demo at your active approval step, or as SCM for approved outstanding demand",
        );
      if (
        (
          await client.query(
            "SELECT id FROM public.device_demo_workspaces WHERE request_item_id=$1 AND status<>'CANCELLED'",
            [itemId],
          )
        ).rows.length
      )
        throw error(409, "A workspace already exists for this device");
      const reviewers = (
        await client.query(
          "SELECT u.id,u.department_id FROM public.users u JOIN public.departments d ON d.id=u.department_id AND d.institute_id=$2 WHERE u.id=ANY($1::int[]) AND u.institute_id=$2 AND u.is_active IS TRUE AND lower(trim(u.role))<>'coo'",
          [reviewerIds, actor.institute_id],
        )
      ).rows;
      if (
        reviewers.length !== reviewerIds.length ||
        !reviewers.some(
          (u) => String(u.department_id) === String(row.department_id),
        )
      )
        throw error(
          400,
          "Include an active requesting-department evaluator; all evaluators must belong to this institute",
        );
      await noDownstream(client, { request_item_id: itemId });
      const snapshot = snapshotItem(row);
      const w = (
        await client.query(
          "INSERT INTO public.device_demo_workspaces(institute_id,request_id,request_item_id,requesting_department_id,title,objectives,criteria,item_snapshot,item_fingerprint,created_by,submission_key,payload_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12) RETURNING *",
          [
            actor.institute_id,
            row.request_id,
            itemId,
            row.department_id,
            title,
            objectives,
            JSON.stringify(definition),
            JSON.stringify(snapshot),
            fingerprint(snapshot),
            actor.id,
            key,
            payload,
          ],
        )
      ).rows[0];
      for (const reviewer of reviewers) {
        await client.query(
          "INSERT INTO public.device_demo_reviewers(workspace_id,reviewer_id,department_id) VALUES($1,$2,$3)",
          [w.id, reviewer.id, reviewer.department_id],
        );
        await notify(
          client,
          reviewer.id,
          "Device demo evaluation assigned",
          title,
          w,
        );
      }
      await journal(client, actor, w, "DEVICE_DEMO_OPENED", objectives);
      return get(actor, w.id, client);
    });
  };
  const options = async (actor, workspaceId) => {
    const w = await get(actor, workspaceId);
    if (!w.can_coordinate)
      throw error(403, "Only demo coordinators may register company demos");
    const suppliers = (
      await database.query(
        "SELECT id,name FROM public.suppliers WHERE (institute_id=$1 OR institute_id IS NULL) AND lower(trim(COALESCE(status,''))) NOT IN ('inactive','suspended','blacklisted') ORDER BY name",
        [actor.institute_id],
      )
    ).rows;
    const catalog = (
      await database.query(
        "SELECT c.id,c.supplier_id,c.approved_product_id,p.product_name,p.manufacturer,p.model FROM public.supplier_catalog_items c JOIN public.approved_products p ON p.id=c.approved_product_id JOIN public.generic_items g ON g.id=p.generic_item_id JOIN public.suppliers s ON s.id=c.supplier_id WHERE p.generic_item_id=$1 AND p.is_active IS TRUE AND p.approval_status='approved' AND c.is_active IS TRUE AND g.is_active IS TRUE AND g.lifecycle_status='active' AND (s.institute_id=$2 OR s.institute_id IS NULL) ORDER BY p.product_name,p.model",
        [w.item_snapshot.generic_item_id, actor.institute_id],
      )
    ).rows;
    return { suppliers, catalog };
  };
  const mutate = async (actor, workspaceId, input, operation) =>
    tx(async (client) => {
      const scoped = await get(actor, workspaceId, client);
      await lock(client, scoped.request_item_id);
      const w = await get(actor, workspaceId, client);
      if (String(input.row_version) !== String(w.row_version))
        throw error(
          409,
          "Workspace changed; reload before submitting",
          "DEVICE_DEMO_VERSION_CONFLICT",
        );
      const editable = ["OPEN", "REVISION_REQUIRED"].includes(w.status);
      const assigned = w.reviewers.some(
        (r) => String(r.reviewer_id) === String(actor.id),
      );
      const notes = required(input.notes || input.findings, "Notes");
      let demo = null;
      if (input.demo_id) {
        demo = w.demos.find((d) => String(d.id) === id(input.demo_id));
        if (!demo) throw error(404, "Demo not found in this workspace");
      }
      const ids = await evidence(client, w, input.attachment_ids);
      if (operation === "document") {
        if (w.status === "CANCELLED" || (!w.can_coordinate && !assigned))
          throw error(
            403,
            "Only workspace coordinators and assigned evaluators can attach supporting documents",
          );
        if (!ids.length)
          throw error(
            400,
            "Select at least one file to attach to the workspace",
          );
      } else if (operation === "opinion") {
        if (!editable || !assigned || demo?.status !== "COMPLETED")
          throw error(
            403,
            "Only an assigned evaluator can report on a completed demo in an open workspace",
          );
        if (
          w.reports.some(
            (r) =>
              String(r.demo_id) === String(demo.id) &&
              String(r.reviewer_id) === String(actor.id),
          )
        )
          throw error(409, "Your submitted demo report is immutable");
        const member = (
          await client.query(
            "SELECT u.id FROM public.users u JOIN public.device_demo_reviewers a ON a.reviewer_id=u.id AND a.department_id=u.department_id WHERE a.workspace_id=$1 AND u.id=$2 AND u.institute_id=$3 AND u.is_active IS TRUE",
            [w.id, actor.id, actor.institute_id],
          )
        ).rows[0];
        if (!member)
          throw error(403, "Your evaluator assignment is no longer current");
        const report = m.report(input, w.criteria),
          signed = await signature(client, actor);
        if (!signed) throw error(403, "Inactive evaluator");
        await client.query(
          "INSERT INTO public.device_demo_reports(demo_id,reviewer_id,scores,weighted_score,recommendation,findings,safety_findings,signature) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb)",
          [
            demo.id,
            actor.id,
            JSON.stringify(report.scores),
            report.weighted_score,
            report.recommendation,
            report.findings,
            report.safety_findings,
            JSON.stringify(signed),
          ],
        );
        await notify(
          client,
          w.created_by,
          "Device demo report submitted",
          w.title,
          w,
        );
      } else if (operation === "observation") {
        if (
          !editable ||
          (!w.can_coordinate && !assigned) ||
          !demo ||
          !["RECEIVED", "EVALUATING", "COMPLETED"].includes(demo.status)
        )
          throw error(
            403,
            "Demo observations require an assigned evaluator or coordinator and a received demo",
          );
      } else if (operation === "decision") {
        if (!w.can_decide || w.status !== "COO_REVIEW")
          throw error(
            403,
            "Only an independent COO can decide a pending demo selection",
          );
        if (!["APPROVED", "REJECTED"].includes(input.decision))
          throw error(400, "Choose approve or reject");
        const selection = w.selections[0];
        if (
          !selection ||
          selection.status !== "PENDING" ||
          String(selection.submitted_by) === String(actor.id)
        )
          throw error(409, "No independent pending selection remains");
        if (input.decision === "APPROVED") {
          await fresh(client, w);
          const comparison = m.comparison(w.demos, w.reports, w.reviewers),
            chosen = comparison.find(
              (d) => String(d.id) === String(selection.demo_id),
            );
          if (!chosen?.suitable)
            throw error(
              409,
              "The selected device must be suitable according to every evaluator",
            );
        }
        const signed = await signature(client, actor);
        if (!signed) throw error(403, "Inactive COO account");
        await client.query(
          "UPDATE public.device_demo_selections SET status=$1,decided_by=$2,decided_at=now(),decision_notes=$3,signature=$4::jsonb WHERE id=$5",
          [
            input.decision,
            actor.id,
            notes,
            JSON.stringify(signed),
            selection.id,
          ],
        );
        w.status =
          input.decision === "APPROVED" ? "SELECTED" : "REVISION_REQUIRED";
        for (const userId of new Set([
          w.created_by,
          ...w.reviewers.map((r) => r.reviewer_id),
        ]))
          await notify(
            client,
            userId,
            "COO demo selection decision",
            `${w.title}: ${input.decision}`,
            w,
          );
      } else {
        if (!w.can_coordinate)
          throw error(403, "Demo coordinator authority required");
        if (operation === "cancel") {
          if (w.status === "CANCELLED")
            throw error(409, "Workspace is already cancelled");
          await noDownstream(client, w);
          w.status = "CANCELLED";
          await client.query(
            "UPDATE public.device_demo_selections SET status='REJECTED',decided_by=$2,decided_at=now(),decision_notes=$3,signature=$4::jsonb WHERE workspace_id=$1 AND status='PENDING'",
            [
              w.id,
              actor.id,
              `Workspace cancelled: ${notes}`,
              JSON.stringify(await signature(client, actor)),
            ],
          );
        } else if (operation === "return") {
          if (
            !demo?.received_at ||
            demo.returned_at ||
            !["COMPLETED", "WITHDRAWN"].includes(demo.status)
          )
            throw error(
              409,
              "Only a received, completed or withdrawn demo can be returned once",
            );
          await client.query(
            "UPDATE public.device_demo_candidates SET returned_at=now() WHERE id=$1",
            [demo.id],
          );
        } else {
          if (!editable)
            throw error(
              409,
              "Workspace is frozen for COO review or already finalized",
            );
          await fresh(client, w);
          if (operation === "candidate") {
            const supplierId = id(input.supplier_id),
              supplier = (
                await client.query(
                  "SELECT id,name FROM public.suppliers WHERE id=$1 AND (institute_id=$2 OR institute_id IS NULL) AND lower(trim(COALESCE(status,''))) NOT IN ('inactive','suspended','blacklisted')",
                  [supplierId, actor.institute_id],
                )
              ).rows[0];
            if (!supplier)
              throw error(
                400,
                "Choose an eligible company from this institute or the shared supplier list",
              );
            let product = null;
            if (input.supplier_catalog_item_id) {
              product = (
                await client.query(
                  "SELECT c.id,c.approved_product_id,p.generic_item_id,p.manufacturer,p.model,p.product_name FROM public.supplier_catalog_items c JOIN public.approved_products p ON p.id=c.approved_product_id JOIN public.generic_items g ON g.id=p.generic_item_id WHERE c.id=$1 AND c.supplier_id=$2 AND c.is_active IS TRUE AND p.is_active IS TRUE AND p.approval_status='approved' AND g.is_active IS TRUE AND g.lifecycle_status='active'",
                  [id(input.supplier_catalog_item_id), supplierId],
                )
              ).rows[0];
              if (
                !product ||
                String(product.generic_item_id) !==
                  String(w.item_snapshot.generic_item_id) ||
                (w.item_snapshot.mandatory_product_id &&
                  String(product.approved_product_id) !==
                    String(w.item_snapshot.mandatory_product_id))
              )
                throw error(
                  400,
                  "The demo catalog product must match the requested identity and company",
                );
            }
            if (w.item_snapshot.generic_item_id && !product)
              throw error(
                400,
                "Link the governed device to an approved supplier catalog product",
              );
            const start = m.date(input.planned_start),
              end = m.date(input.planned_end);
            if (end < start)
              throw error(400, "Evaluation end date cannot precede its start");
            demo = (
              await client.query(
                "INSERT INTO public.device_demo_candidates(workspace_id,supplier_id,supplier_name,manufacturer,model,serial_number,approved_product_id,supplier_catalog_item_id,planned_start,planned_end,location,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
                [
                  w.id,
                  supplierId,
                  supplier.name,
                  product?.manufacturer ||
                    required(input.manufacturer, "Manufacturer", 250),
                  product?.model ||
                    product?.product_name ||
                    required(input.model, "Device model", 250),
                  m.text(input.serial_number, 250),
                  product?.approved_product_id || null,
                  product?.id || null,
                  start,
                  end,
                  required(input.location, "Trial location", 250),
                  required(
                    input.description,
                    "Demo configuration / description",
                  ),
                  actor.id,
                ],
              )
            ).rows[0];
          } else if (operation === "transition") {
            if (!demo || !m.NEXT[demo.status]?.includes(input.status))
              throw error(409, "Invalid demo lifecycle transition");
            const column = {
              RECEIVED: "received_at",
              EVALUATING: "started_at",
              COMPLETED: "completed_at",
            }[input.status];
            await client.query(
              `UPDATE public.device_demo_candidates SET status=$1${column ? `,${column}=now()` : ""} WHERE id=$2`,
              [input.status, demo.id],
            );
          } else if (operation === "recommend") {
            const comparison = m.comparison(w.demos, w.reports, w.reviewers),
              chosen = comparison.find(
                (d) => String(d.id) === String(input.demo_id),
              );
            if (!chosen?.suitable)
              throw error(
                409,
                "Select a completed demo approved as suitable by every evaluator",
              );
            const coos = (
              await client.query(COO_USERS, [actor.institute_id])
            ).rows.filter(
              (u) =>
                String(u.id) !== String(actor.id) &&
                String(u.id) !== String(w.created_by) &&
                !w.reviewers.some(
                  (r) => String(r.reviewer_id) === String(u.id),
                ),
            );
            if (!coos.length)
              throw error(
                409,
                "An active independent COO authority is required before submitting selection",
              );
            await client.query(
              "INSERT INTO public.device_demo_selections(workspace_id,demo_id,rationale,comparison_snapshot,submitted_by) VALUES($1,$2,$3,$4::jsonb,$5)",
              [w.id, chosen.id, notes, JSON.stringify(comparison), actor.id],
            );
            w.status = "COO_REVIEW";
            for (const coo of coos)
              await notify(
                client,
                coo.id,
                "Device demo selection awaits COO approval",
                w.title,
                w,
              );
          } else throw error(400, "Unknown demo operation");
        }
      }
      await client.query(
        "UPDATE public.device_demo_workspaces SET status=$1,row_version=row_version+1 WHERE id=$2",
        [w.status, w.id],
      );
      await journal(
        client,
        actor,
        w,
        `DEVICE_DEMO_${operation.toUpperCase()}`,
        notes,
        demo?.id || null,
        ids,
      );
      return get(actor, w.id, client);
    });
  return { list, get, eligible, directory, create, options, mutate };
}
module.exports = { createDeviceDemoService };
