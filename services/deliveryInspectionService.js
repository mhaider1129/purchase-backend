"use strict";
const p = require("./technicalReviewProfiles");
const reviewerScope = require("./technicalReviewerScope");
const {
  error,
  text,
  canManage,
} = require("./preprocurementTechnicalReviewModel");
const {
  decimal,
  scaledBigIntToDecimalString: format,
} = require("./goodsReceiptService");
const permitted = (a, code) =>
  Boolean(a?.hasPermission?.(code) || a?.permissions?.includes(code));
const scope = (a) => {
  if (!a?.id || !Number(a.institute_id))
    throw error(403, "Institute account required");
};
const notify = (db, user, task, message) =>
  db.query(
    "INSERT INTO notifications(user_id,title,message,link,metadata) VALUES($1,'Delivery technical inspection',$2,$3,$4::jsonb)",
    [
      user,
      message,
      `/technical-inspections?delivery=${task}`,
      JSON.stringify({ delivery_inspection_id: String(task) }),
    ],
  );
async function prepare(db, po, line, actor, cachedProfiles) {
  if (line.technical_review_requested && !cachedProfiles)
    await p.requireSchema(db);
  const natural =
    cachedProfiles !== undefined
      ? cachedProfiles?.get(String(line.requested_item_id))
      : await p.profileForItem(db, {
          requested_item_id: line.requested_item_id,
        });
  let selected = natural?.settings.delivery_required ? natural : null;
  if (line.technical_review_requested) {
    const extraKey =
      line.technical_profile_key || natural?.profile_key || "unclassified";
    if (cachedProfiles && !cachedProfiles.additionalProfiles)
      cachedProfiles.additionalProfiles = new Map();
    let extra =
      natural?.profile_key === extraKey
        ? natural
        : cachedProfiles?.additionalProfiles?.get(extraKey);
    if (!extra) {
      extra = await p.profileForItem(
        db,
        { requested_item_id: line.requested_item_id },
        extraKey,
      );
      if (extra && cachedProfiles)
        cachedProfiles.additionalProfiles.set(extraKey, extra);
    }
    if (!extra)
      throw error(
        409,
        "Configure the additional technical responsibility in Management before requesting it",
      );
    if (!selected) selected = extra;
    else if (extra.profile_key !== selected.profile_key)
      selected = {
        ...selected,
        profile_key: selected.profile_key + " + " + extra.profile_key,
        row_version:
          String(selected.row_version) + " + " + String(extra.row_version),
        settings: {
          ...selected.settings,
          level: Math.max(selected.settings.level, extra.settings.level),
          evidence_required:
            selected.settings.evidence_required ||
            extra.settings.evidence_required,
          delivery_checks: [
            ...new Set([
              ...selected.settings.delivery_checks,
              ...extra.settings.delivery_checks,
            ]),
          ],
          reviewers: [
            ...selected.settings.reviewers,
            ...extra.settings.reviewers,
          ],
        },
      };
  }
  if (!selected) {
    if (line.technical_review_requested)
      throw error(
        409,
        "Configure a technical inspection profile in Management before requesting this inspection",
      );
    return null;
  }
  if (!selected.settings.delivery_required && !line.technical_review_requested)
    return null;
  if (Number(selected.institute_id) !== Number(actor.institute_id))
    throw error(403, "Inspection profile institute mismatch");
  if (cachedProfiles && !cachedProfiles.resolvedReviewers)
    cachedProfiles.resolvedReviewers = new Map();
  const responsibilityKey =
    selected.profile_key +
    "|" +
    selected.row_version +
    "|" +
    selected.department_id;
  let reviewers = cachedProfiles?.resolvedReviewers?.get(responsibilityKey);
  if (!reviewers) {
    reviewers = await p.resolveReviewers(db, selected, selected.department_id);
    if (cachedProfiles)
      cachedProfiles.resolvedReviewers.set(responsibilityKey, reviewers);
  }
  if (
    !reviewers.length ||
    reviewers.some((u) => String(u.id) === String(actor.id))
  )
    throw error(
      409,
      "Delivery inspectors must be independent of the receiving officer",
    );
  return {
    coordinator_id: selected.updated_by,
    profile_key: selected.profile_key,
    profile_version: selected.row_version,
    ...selected.settings,
    reviewers,
    requesting_department_id: selected.department_id,
  };
}
async function generate(db, receipt, line, prepared, actor) {
  if (!prepared) return;
  const task = (
    await db.query(
      "INSERT INTO delivery_inspection_tasks(institute_id,receipt_item_id,request_id,department_id,profile_snapshot,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING *",
      [
        actor.institute_id,
        line.id,
        receipt.request_id,
        prepared.requesting_department_id,
        JSON.stringify(prepared),
        actor.id,
      ],
    )
  ).rows[0];
  await require("../repositories/connectedP2PRepository")
    .createConnectedP2PRepository(db)
    .markReceiptInspectionRequired(line.id);
  for (const u of prepared.reviewers) {
    await db.query(
      "INSERT INTO delivery_inspection_assignments(task_id,department_id,reviewer_id) VALUES($1,$2,$3)",
      [task.id, u.department_id, u.id],
    );
    await notify(
      db,
      u.id,
      task.id,
      `Inspect ${line.item_name} on ${receipt.receipt_number}`,
    );
  }
  await p.history(db, {
    actor,
    taskId: task.id,
    action: "DELIVERY_INSPECTION_GENERATED",
    payload: { receipt_item_id: line.id, profile: prepared },
  });
  return task;
}
async function activeManager(db, actor) {
  p.requireManager(actor);
  const user = (
    await db.query(
      "SELECT id,name,role FROM users WHERE id=$1 AND institute_id=$2 AND is_active FOR SHARE",
      [actor.id, actor.institute_id],
    )
  ).rows[0];
  if (!user || !canManage({ ...actor, role: user.role }))
    throw error(409, "SCM authority changed; reload before deciding");
  return { ...user, signed_at: new Date().toISOString() };
}
function createDeliveryInspectionService(database) {
  const tx = async (work) => {
    const db = await database.connect();
    try {
      await db.query("BEGIN");
      await p.requireSchema(db);
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  };
  const get = async (actor, id, db = database) => {
    scope(actor);
    await p.requireSchema(db);
    const task = (
      await db.query(
        `SELECT t.*,gri.*,t.id AS id,t.row_version AS row_version,gri.id AS receipt_item_id,gr.receipt_number,gr.received_at,po.po_number,po.id AS purchase_order_id,po.supplier_id,s.name AS supplier_name,to_jsonb(ap) AS approved_product,m.manufacturer_name AS manufacturer,ri.specs,d.name AS requesting_department FROM delivery_inspection_tasks t JOIN goods_receipt_items gri ON gri.id=t.receipt_item_id JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id JOIN purchase_orders po ON po.id=gr.purchase_order_id JOIN suppliers s ON s.id=po.supplier_id JOIN requested_items ri ON ri.id=gri.requested_item_id LEFT JOIN approved_products ap ON ap.id=gri.approved_product_id LEFT JOIN item_manufacturers m ON m.id=ap.manufacturer_id JOIN departments d ON d.id=t.department_id WHERE t.id=$1 AND t.institute_id=$2 AND ($3 OR t.created_by=$4 OR EXISTS(SELECT 1 FROM delivery_inspection_assignments a JOIN users u ON u.id=a.reviewer_id WHERE a.task_id=t.id AND a.reviewer_id=$4 AND u.is_active AND u.institute_id=$2 AND ${reviewerScope("u", "a.department_id", "$2")}))`,
        [
          id,
          actor.institute_id,
          canManage(actor) ||
            permitted(actor, "procure-to-pay.receipts.manage"),
          actor.id,
        ],
      )
    ).rows[0];
    if (!task) throw error(404, "Delivery inspection task not found");
    task.assignments = (
      await db.query(
        "SELECT a.*,u.name,d.name AS department_name FROM delivery_inspection_assignments a JOIN users u ON u.id=a.reviewer_id JOIN departments d ON d.id=a.department_id WHERE task_id=$1 ORDER BY a.id",
        [id],
      )
    ).rows;
    task.history = (
      await db.query(
        "SELECT * FROM technical_workflow_history WHERE delivery_task_id=$1 AND institute_id=$2 ORDER BY id",
        [id, actor.institute_id],
      )
    ).rows;
    task.attachments = (
      await db.query(
        "SELECT id,file_name FROM attachments WHERE request_id=$1 ORDER BY id",
        [task.request_id],
      )
    ).rows;
    task.remaining_quantity = format(
      decimal(task.received_quantity, "received") -
        decimal(task.damaged_quantity, "damaged") -
        decimal(task.short_quantity, "short") -
        decimal(task.technical_accepted_quantity, "accepted") -
        decimal(task.technical_rejected_quantity, "rejected"),
    );
    return {
      ...task,
      current_user_id: actor.id,
      can_manage: canManage(actor),
      can_receive: permitted(actor, "procure-to-pay.receipts.manage"),
      checks: p.DELIVERY_CHECKS,
    };
  };
  const mutate = async (actor, id, input, op) =>
    tx(async (db) => {
      scope(actor);
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('delivery-inspection:'||$1::text,0))",
        [id],
      );
      const task = await get(actor, id, db);
      if (String(task.row_version) !== String(input.row_version))
        throw error(409, "Inspection changed; reload before submitting");
      if (task.status === "CLOSED")
        throw error(409, "This inspection is closed");
      if (op === "start") {
        const own = task.assignments.find(
          (a) => String(a.reviewer_id) === String(actor.id),
        );
        if (
          !own ||
          own.opinion ||
          !["PENDING", "IN_PROGRESS"].includes(task.status)
        )
          throw error(
            403,
            "Only the assigned pending inspector can start this task",
          );
        await db.query(
          "UPDATE delivery_inspection_tasks SET status='IN_PROGRESS',row_version=row_version+1 WHERE id=$1",
          [id],
        );
        await p.history(db, {
          actor,
          taskId: id,
          action: "DELIVERY_INSPECTION_STARTED",
          payload: { notes: "Inspection started" },
        });
      } else if (op === "opinion") {
        const own = task.assignments.find(
          (a) => String(a.reviewer_id) === String(actor.id),
        );
        if (
          !own ||
          own.opinion ||
          !["PENDING", "IN_PROGRESS"].includes(task.status)
        )
          throw error(403, "Only the assigned pending inspector may attest");
        if (
          !["ACCEPTED", "PARTIAL", "HOLD", "REJECTED"].includes(input.decision)
        )
          throw error(400, "Choose a delivery decision");
        const remaining = decimal(task.remaining_quantity, "remaining"),
          accepted = decimal(input.accepted_quantity || 0, "accepted"),
          rejected = decimal(input.rejected_quantity || 0, "rejected");
        if (accepted + rejected > remaining || remaining <= 0n)
          throw error(
            400,
            "Accepted and rejected quantities exceed the unclassified balance",
          );
        if (
          (input.decision === "ACCEPTED" &&
            (accepted !== remaining || rejected !== 0n)) ||
          (input.decision === "REJECTED" &&
            (rejected !== remaining || accepted !== 0n)) ||
          (input.decision === "HOLD" && (accepted !== 0n || rejected !== 0n)) ||
          (input.decision === "PARTIAL" &&
            (accepted <= 0n || accepted >= remaining))
        )
          throw error(400, "Quantities do not match the selected decision");
        if (input.decision !== "ACCEPTED" && !text(input.notes))
          throw error(
            400,
            "Explain conditions, corrective action or rejection",
          );
        const assessment = {};
        for (const key of task.profile_snapshot.delivery_checks) {
          if (!p.DELIVERY_CHECKS[key].includes(input.assessment?.[key]))
            throw error(400, `Complete ${key}`);
          assessment[key] = input.assessment[key];
        }
        if (
          accepted > 0n &&
          Object.values(assessment).some((v) =>
            ["no", "fail", "not_assessed"].includes(v),
          )
        )
          throw error(
            400,
            "Failed technical checks cannot release accepted quantity; separate affected units or hold this delivery",
          );
        const files = Array.isArray(input.attachment_ids)
          ? [...new Set(input.attachment_ids.map(String))]
          : [];
        if (
          files.length > 20 ||
          files.some((v) => !/^\d+$/.test(v)) ||
          (task.profile_snapshot.evidence_required && !files.length)
        )
          throw error(
            400,
            "Supporting evidence is required by this inspection policy",
          );
        if (
          (
            await db.query(
              "SELECT id FROM attachments WHERE request_id=$1 AND id=ANY($2::integer[])",
              [task.request_id, files],
            )
          ).rows.length !== files.length
        )
          throw error(
            400,
            "Inspection evidence must belong to the linked request",
          );
        await p.retainEvidence(db, actor, null, id, files);
        const user = (
          await db.query(
            `SELECT u.id,u.name,u.role FROM users u WHERE u.id=$1 AND u.institute_id=$2 AND ${reviewerScope("u", "$3", "$2")} AND u.is_active FOR SHARE OF u`,
            [actor.id, actor.institute_id, own.department_id],
          )
        ).rows[0];
        if (!user) throw error(409, "Reviewer responsibility changed");
        const opinion = {
          decision: input.decision,
          accepted_quantity: format(accepted),
          rejected_quantity: format(rejected),
          held_quantity: format(remaining - accepted - rejected),
          assessment,
          notes: text(input.notes),
          attachment_ids: files,
          signature: { ...user, signed_at: new Date().toISOString() },
          round: task.opinion_round,
        };
        await db.query(
          "UPDATE delivery_inspection_assignments SET opinion=$2::jsonb,submitted_at=now() WHERE id=$1",
          [own.id, JSON.stringify(opinion)],
        );
        await db.query(
          "UPDATE delivery_inspection_tasks SET status='IN_PROGRESS',row_version=row_version+1 WHERE id=$1",
          [id],
        );
        await p.history(db, {
          actor,
          taskId: id,
          action: "DELIVERY_OPINION_ATTESTED",
          payload: opinion,
        });
        for (const user of new Set(
          [task.created_by, task.profile_snapshot.coordinator_id].filter(
            Boolean,
          ),
        ))
          await notify(
            db,
            user,
            id,
            "A delivery technical opinion is ready for final disposition",
          );
      } else if (op === "decide") {
        const signatory = await activeManager(db, actor);
        if (
          task.assignments.some(
            (a) => String(a.reviewer_id) === String(actor.id),
          )
        )
          throw error(
            403,
            "The final disposition must be independent of technical opinions",
          );
        if (
          !["PENDING", "IN_PROGRESS"].includes(task.status) ||
          task.assignments.some((a) => !a.opinion) ||
          !text(input.notes)
        )
          throw error(
            409,
            "All opinions and final disposition notes are required",
          );
        const first = task.assignments[0].opinion;
        if (
          task.assignments.some((a) =>
            ["accepted_quantity", "rejected_quantity", "held_quantity"].some(
              (k) => a.opinion[k] !== first[k],
            ),
          )
        )
          throw error(
            409,
            "Reviewers disagree on quantity disposition. Reopen for clarification before final acceptance",
          );
        const disposition = {
          ...first,
          notes: text(input.notes),
          scm_signature: signatory,
          decided_by: actor.id,
          decided_at: new Date().toISOString(),
        };
        const event = await p.history(db, {
          actor,
          taskId: id,
          action: "DELIVERY_DISPOSITION_AUTHORIZED",
          payload: disposition,
        });
        await db.query(
          "UPDATE delivery_inspection_tasks SET status='DECIDED',pending_disposition=$2::jsonb,row_version=row_version+1 WHERE id=$1",
          [id, JSON.stringify({ ...disposition, history_id: event.id })],
        );
        await notify(
          db,
          task.created_by,
          id,
          "Technical disposition is authorized; receiving must apply it",
        );
      } else if (op === "reopen") {
        await activeManager(db, actor);
        if (!text(input.notes) || task.status === "DECIDED")
          throw error(
            409,
            "Apply the authorized disposition before starting another round, and record a reason",
          );
        await p.history(db, {
          actor,
          taskId: id,
          action: "DELIVERY_INSPECTION_REOPENED",
          payload: {
            notes: text(input.notes),
            previous_assignments: task.assignments,
            round: task.opinion_round,
          },
        });
        await db.query(
          "UPDATE delivery_inspection_assignments SET opinion=NULL,submitted_at=NULL WHERE task_id=$1",
          [id],
        );
        await db.query(
          "UPDATE delivery_inspection_tasks SET status='PENDING',opinion_round=opinion_round+1,row_version=row_version+1 WHERE id=$1",
          [id],
        );
        for (const a of task.assignments)
          await notify(db, a.reviewer_id, id, text(input.notes, 500));
      }
      return get(actor, id, db);
    });
  return {
    get,
    start: (a, id, i) => mutate(a, id, i, "start"),
    opinion: (a, id, i) => mutate(a, id, i, "opinion"),
    decide: (a, id, i) => mutate(a, id, i, "decide"),
    reopen: (a, id, i) => mutate(a, id, i, "reopen"),
  };
}
module.exports = {
  prepare,
  generate,
  createDeliveryInspectionService,
  permitted,
  notify,
};
