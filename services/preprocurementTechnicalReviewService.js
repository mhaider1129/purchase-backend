"use strict";
const model = require("./preprocurementTechnicalReviewModel");
const profiles = require("./technicalReviewProfiles");
const reviewerScope = require("./technicalReviewerScope");
const { writeAuditEvent } = require("./auditService");
const {
  error,
  text,
  canManage,
  snapshotItem,
  fingerprint,
  normalizeEvidence,
  normalizeReports,
} = model;
const scope = (actor) => {
  if (
    !Number.isInteger(Number(actor.institute_id)) ||
    Number(actor.institute_id) < 1
  )
    throw error(403, "An institute is required for technical review");
};
const manage = (actor) => {
  scope(actor);
  if (!canManage(actor))
    throw error(
      403,
      "SCM technical-inspection management permission is required",
    );
};
function createTechnicalReviewService(database) {
  const configured = async (client) => {
    const result = await client.query(
      "SELECT to_regclass('public.preprocurement_technical_reviews') IS NOT NULL AND to_regclass('public.preprocurement_technical_review_assignments') IS NOT NULL AND to_regclass('public.preprocurement_technical_review_policy') IS NOT NULL AS available",
    );
    if (!result.rows[0]?.available)
      throw error(
        503,
        "Apply SQL 049 to enable pre-procurement technical reviews",
        "TECHNICAL_REVIEW_SCHEMA_REQUIRED",
      );
    if (await profiles.installed(client)) await profiles.requireSchema(client);
  };
  const transaction = async (work) => {
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
  const lock = async (client, id) =>
    client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('technical-review:'||$1::text,0))",
      [id],
    );
  const policy = async (actor) => {
    manage(actor);
    await configured(database);
    return (
      (
        await database.query(
          "SELECT require_for_all,reason,updated_at FROM public.preprocurement_technical_review_policy WHERE institute_id=$1",
          [actor.institute_id],
        )
      ).rows[0] || { require_for_all: false }
    );
  };
  const updatePolicy = async (actor, input) => {
    manage(actor);
    if (typeof input.require_for_all !== "boolean" || !text(input.reason))
      throw error(400, "A policy setting and change reason are required");
    return transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('technical-review-policy:'||$1::text,0))",
        [actor.institute_id],
      );
      const before = (
        await client.query(
          "SELECT * FROM public.preprocurement_technical_review_policy WHERE institute_id=$1",
          [actor.institute_id],
        )
      ).rows[0] || { require_for_all: false };
      const after = (
        await client.query(
          "INSERT INTO public.preprocurement_technical_review_policy(institute_id,require_for_all,reason,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(institute_id) DO UPDATE SET require_for_all=EXCLUDED.require_for_all,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *",
          [
            actor.institute_id,
            input.require_for_all,
            text(input.reason),
            actor.id,
          ],
        )
      ).rows[0];
      await writeAuditEvent({
        client,
        entityType: "technical_review_policy",
        entityId: actor.institute_id,
        instituteId: actor.institute_id,
        actorUserId: actor.id,
        action: "TECHNICAL_REVIEW_POLICY_UPDATED",
        beforeData: before,
        afterData: after,
        reason: text(input.reason),
      });
      return after;
    });
  };
  const directory = async (actor) => {
    manage(actor);
    return (
      await database.query(
        `SELECT u.id,u.name,u.role,u.department_id,d.name AS department_name
    FROM public.users u JOIN public.departments d ON d.id=u.department_id
    WHERE u.institute_id=$1 AND u.is_active IS TRUE AND u.id<>$2 AND d.institute_id=$1 ORDER BY d.name,u.name`,
        [actor.institute_id, actor.id],
      )
    ).rows;
  };
  const eligible = async (actor, search = "") => {
    manage(actor);
    const rows = (
      await database.query(
        `SELECT r.id,r.department_id,d.name AS department_name,r.maintenance_ref_number,r.justification,
    jsonb_agg(to_jsonb(ri)||jsonb_build_object('technical_item_type',g.item_type) ORDER BY ri.id) AS items
    FROM public.requests r JOIN public.requested_items ri ON ri.request_id=r.id JOIN public.departments d ON d.id=r.department_id LEFT JOIN public.generic_items g ON g.id=ri.generic_item_id
    WHERE r.institute_id=$1 AND d.institute_id=$1 AND lower(trim(r.status)) IN ('approved','partially procured','partially_procured') AND r.request_type<>'Warehouse Supply'
      AND lower(trim(COALESCE(ri.approval_status,''))) NOT IN ('rejected','available in stock','available_in_stock','in stock','in_stock')
      AND lower(trim(COALESCE(ri.procurement_status,''))) NOT IN ('purchased','completed','received','available in stock','available_in_stock','in stock','in_stock','cancelled','canceled','not_procured')
      AND COALESCE(ri.purchased_quantity,0)<ri.quantity
      AND (r.id::text ILIKE $2 OR COALESCE(r.maintenance_ref_number,'') ILIKE $2 OR COALESCE(r.justification,'') ILIKE $2 OR EXISTS(SELECT 1 FROM public.requested_items searched WHERE searched.request_id=r.id AND searched.item_name ILIKE $2))
    GROUP BY r.id,d.name ORDER BY r.created_at DESC LIMIT 100`,
        [actor.institute_id, `%${text(search, 200)}%`],
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      items: row.items.map((item) => ({
        ...item,
        technical_category: profiles.categoryForType(item.technical_item_type),
      })),
    }));
  };
  const list = async (actor, search = "") => {
    scope(actor);
    await configured(database);
    return (
      await database.query(
        `SELECT t.id,t.request_id,t.status,t.row_version,t.created_at,r.maintenance_ref_number,r.justification,
    count(a.id) AS reviewer_count,count(a.id) FILTER(WHERE a.status IN ('PENDING','IN_PROGRESS')) AS pending_count,count(a.id) FILTER(WHERE a.status='REJECTED') AS rejected_count
    FROM public.preprocurement_technical_reviews t JOIN public.requests r ON r.id=t.request_id
    JOIN public.preprocurement_technical_review_assignments a ON a.review_id=t.id
    WHERE t.institute_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM public.preprocurement_technical_review_assignments own JOIN public.users u ON u.id=own.reviewer_id WHERE own.review_id=t.id AND own.reviewer_id=$3 AND u.institute_id=$1 AND ${reviewerScope("u", "own.department_id", "$1")} AND u.is_active IS TRUE))
      AND (t.request_id::text ILIKE $4 OR COALESCE(r.maintenance_ref_number,'') ILIKE $4 OR COALESCE(r.justification,'') ILIKE $4)
    GROUP BY t.id,r.id ORDER BY (t.status='IN_REVIEW') DESC,t.created_at DESC LIMIT 100`,
        [
          actor.institute_id,
          canManage(actor),
          actor.id,
          `%${text(search, 200)}%`,
        ],
      )
    ).rows;
  };
  const get = async (actor, id, client = database) => {
    scope(actor);
    await configured(client);
    const review = (
      await client.query(
        `SELECT t.*,r.maintenance_ref_number,d.name AS requesting_department_name,creator.name AS created_by_name
      FROM public.preprocurement_technical_reviews t JOIN public.requests r ON r.id=t.request_id
      JOIN public.departments d ON d.id=t.requesting_department_id JOIN public.users creator ON creator.id=t.created_by
      WHERE t.id=$1 AND t.institute_id=$2 AND ($3::boolean OR EXISTS(SELECT 1 FROM public.preprocurement_technical_review_assignments a JOIN public.users u ON u.id=a.reviewer_id WHERE a.review_id=t.id AND a.reviewer_id=$4 AND u.institute_id=$2 AND ${reviewerScope("u", "a.department_id", "$2")} AND u.is_active IS TRUE))`,
        [id, actor.institute_id, canManage(actor), actor.id],
      )
    ).rows[0];
    if (!review) throw error(404, "Technical review not found");
    review.assignments = (
      await client.query(
        `SELECT a.*,u.name AS reviewer_name,u.role AS reviewer_title,d.name AS department_name
      FROM public.preprocurement_technical_review_assignments a JOIN public.users u ON u.id=a.reviewer_id JOIN public.departments d ON d.id=a.department_id WHERE a.review_id=$1 ORDER BY a.id`,
        [id],
      )
    ).rows;
    const ids = [
      ...new Set(
        review.item_packets
          .flatMap((packet) => packet.evidence.attachment_ids)
          .map(String),
      ),
    ];
    review.attachments = ids.length
      ? (
          await client.query(
            "SELECT id,file_name FROM public.attachments WHERE request_id=$1 AND id=ANY($2::int[])",
            [review.request_id, ids],
          )
        ).rows
      : [];
    review.history = (await profiles.installed(client))
      ? (
          await client.query(
            "SELECT * FROM technical_workflow_history WHERE review_id=$1 AND institute_id=$2 ORDER BY id",
            [id, actor.institute_id],
          )
        ).rows
      : [];
    return {
      ...review,
      can_manage: canManage(actor),
      current_user_id: actor.id,
    };
  };
  const notify = (client, userId, title, message, id) =>
    client.query(
      "INSERT INTO public.notifications(user_id,title,message,link,metadata) VALUES($1,$2,$3,$4,$5::jsonb)",
      [
        userId,
        title,
        message,
        `/technical-inspections/pre-procurement?review=${id}`,
        JSON.stringify({ technical_review_id: String(id) }),
      ],
    );
  const validateProposal = require("./technicalProposalSnapshot").prepare;
  const create = async (actor, input, internal = false) => {
    manage(actor);
    if (
      !/^\d+$/.test(String(input.request_id)) ||
      !Array.isArray(input.items) ||
      input.items.some((row) => !/^\d+$/.test(String(row.item_id))) ||
      !input.items.length ||
      input.items.length > 100 ||
      new Set(input.items.map((row) => String(row.item_id))).size !==
        input.items.length
    )
      throw error(400, "Choose a request and its items for technical review");
    const reviewerIds = Array.isArray(input.reviewer_ids)
      ? input.reviewer_ids.map(String)
      : [];
    if (
      !reviewerIds.length ||
      reviewerIds.length > 20 ||
      new Set(reviewerIds).size !== reviewerIds.length ||
      reviewerIds.some((id) => !/^\d+$/.test(id) || id === String(actor.id))
    )
      throw error(
        400,
        "Select distinct departmental reviewers other than the SCM signatory",
      );
    if (!text(input.instructions) || !text(input.submission_key, 128))
      throw error(400, "Review instructions and submission key are required");
    const evidence = input.items.map((row) => ({
      item_id: String(row.item_id),
      evidence: normalizeEvidence(row.evidence),
    }));
    const payload = fingerprint({
      request_id: String(input.request_id),
      evidence,
      reviewerIds: [...reviewerIds].sort(),
      ...(internal
        ? { reviewer_assignments: input.reviewer_assignments || [] }
        : {}),
      instructions: text(input.instructions),
    });
    return transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended('technical-review-policy:'||$1::text,0))",
        [actor.institute_id],
      );
      await lock(client, input.request_id);
      const retry = (
        await client.query(
          "SELECT id,payload_fingerprint FROM public.preprocurement_technical_reviews WHERE institute_id=$1 AND submission_key=$2",
          [actor.institute_id, text(input.submission_key, 128)],
        )
      ).rows[0];
      if (retry) {
        if (retry.payload_fingerprint !== payload)
          throw error(
            409,
            "Submission key was already used for different review details",
          );
        return get(actor, retry.id, client);
      }
      const request = (
        await client.query(
          "SELECT r.* FROM public.requests r JOIN public.departments d ON d.id=r.department_id AND d.institute_id=r.institute_id WHERE r.id=$1 AND r.institute_id=$2 AND lower(trim(r.status)) IN ('approved','partially procured','partially_procured') AND request_type<>'Warehouse Supply'",
          [input.request_id, actor.institute_id],
        )
      ).rows[0];
      if (!request?.department_id)
        throw error(
          409,
          "Choose an approved request with a requesting department in your institute",
        );
      const itemProfiles = await profiles.forItems(
        client,
        evidence.map((row) => row.item_id),
        actor.institute_id,
      );
      const mandatory = [],
        requiredByProfile = new Map();
      for (const item of evidence) {
        const profile = itemProfiles?.get(String(item.item_id));
        if (
          profile &&
          String(profile.institute_id) !== String(actor.institute_id)
        )
          throw error(403, "Technical item is outside this institute");
        if (profile?.settings.pre_required) {
          if (!requiredByProfile.has(profile.profile_key))
            requiredByProfile.set(
              profile.profile_key,
              await profiles.resolveReviewers(
                client,
                profile,
                request.department_id,
              ),
            );
          for (const required of requiredByProfile.get(profile.profile_key)) {
            if (!reviewerIds.includes(String(required.id)))
              throw error(
                400,
                "Include every reviewer required by the configured technical responsibility",
              );
            if (
              !mandatory.some(
                (m) => String(m.reviewer_id) === String(required.id),
              )
            )
              mandatory.push({
                reviewer_id: required.id,
                department_id: required.department_id,
              });
          }
        }
      }
      const reviewers = (
        await client.query(
          "SELECT u.id,u.department_id FROM public.users u JOIN public.departments d ON d.id=u.department_id AND d.institute_id=$2 WHERE u.id=ANY($1::int[]) AND u.institute_id=$2 AND u.is_active IS TRUE",
          [reviewerIds, actor.institute_id],
        )
      ).rows;
      for (const reviewer of reviewers) {
        const mapping = [
          ...mandatory,
          ...(internal ? input.reviewer_assignments || [] : []),
        ].find((a) => String(a.reviewer_id) === String(reviewer.id));
        if (
          mapping &&
          String(mapping.department_id) !== String(reviewer.department_id)
        ) {
          if (
            !(
              await client.query(
                `SELECT u.id FROM users u WHERE u.id=$1 AND u.institute_id=$2 AND ${reviewerScope("u", "$3", "$2")}`,
                [reviewer.id, actor.institute_id, mapping.department_id],
              )
            ).rows.length
          )
            throw error(409, "Organizational technical responsibility changed");
          reviewer.department_id = mapping.department_id;
        }
      }
      if (
        reviewers.length !== reviewerIds.length ||
        !reviewers.some(
          (row) => String(row.department_id) === String(request.department_id),
        )
      )
        throw error(
          400,
          "Include an active reviewer from the requesting department; all reviewers must belong to this institute",
        );
      const active = (
        await client.query(
          "SELECT id FROM public.preprocurement_technical_reviews WHERE request_id=$1 AND status='IN_REVIEW'",
          [request.id],
        )
      ).rows[0];
      if (active)
        throw error(
          409,
          "An active technical review already exists; complete or cancel it with a reason before starting another round",
        );
      const rows = (
        await client.query(
          "SELECT * FROM public.requested_items WHERE request_id=$1 AND id=ANY($2::int[]) AND lower(trim(COALESCE(approval_status,''))) NOT IN ('rejected','available in stock','available_in_stock','in stock','in_stock') AND lower(trim(COALESCE(procurement_status,''))) NOT IN ('purchased','completed','received','available in stock','available_in_stock','in stock','in_stock','cancelled','canceled','not_procured') AND COALESCE(purchased_quantity,0)<quantity",
          [request.id, evidence.map((row) => row.item_id)],
        )
      ).rows;
      if (rows.length !== evidence.length)
        throw error(
          409,
          "One or more selected items are unavailable or no longer need procurement",
        );
      const packets = evidence.map((row) => {
        const snapshot = snapshotItem(
          rows.find((item) => String(item.id) === row.item_id),
        );
        return { ...row, snapshot, fingerprint: fingerprint(snapshot) };
      });
      for (const packet of packets) {
        const profile = itemProfiles?.get(String(packet.item_id));
        if (profile)
          packet.assessment_policy = {
            ...profile.settings,
            profile_key: profile.profile_key,
            row_version: profile.row_version,
          };
        if (internal) packet.awaiting_proposal = true;
        else if (
          profile?.settings.evidence_required &&
          !packet.evidence.attachment_ids.length
        )
          throw error(
            400,
            "This inspection policy requires supporting evidence",
          );
        await validateProposal(client, actor, packet.evidence, packet.item_id);
        if (
          !internal &&
          profile?.settings.pre_required &&
          !packet.evidence.supplier_id
        )
          throw error(
            400,
            "Select the actual proposed supplier for a required technical review",
          );
      }
      const attachmentIds = [
        ...new Set(
          packets.flatMap((row) => row.evidence.attachment_ids).map(String),
        ),
      ];
      if (attachmentIds.length) {
        const attachments = await client.query(
          "SELECT id FROM public.attachments WHERE request_id=$1 AND id=ANY($2::int[])",
          [request.id, attachmentIds],
        );
        if (attachments.rows.length !== attachmentIds.length)
          throw error(400, "Evidence attachments must belong to this request");
      }
      const review = (
        await client.query(
          "INSERT INTO public.preprocurement_technical_reviews(institute_id,request_id,requesting_department_id,item_packets,instructions,submission_key,payload_fingerprint,created_by) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8) RETURNING id",
          [
            actor.institute_id,
            request.id,
            request.department_id,
            JSON.stringify(packets),
            text(input.instructions),
            text(input.submission_key, 128),
            payload,
            actor.id,
          ],
        )
      ).rows[0];
      await profiles.retainEvidence(
        client,
        actor,
        review.id,
        null,
        attachmentIds,
      );
      for (const reviewer of reviewers) {
        await client.query(
          "INSERT INTO public.preprocurement_technical_review_assignments(review_id,department_id,reviewer_id) VALUES($1,$2,$3)",
          [review.id, reviewer.department_id, reviewer.id],
        );
        await notify(
          client,
          reviewer.id,
          "Technical opinion requested",
          `Review request #${request.id} before procurement, using the provided sample or technical evidence.`,
          review.id,
        );
      }
      await writeAuditEvent({
        client,
        entityType: "preprocurement_technical_review",
        entityId: review.id,
        requestId: request.id,
        instituteId: actor.institute_id,
        actorUserId: actor.id,
        action: "TECHNICAL_REVIEW_SENT",
        afterData: {
          item_ids: packets.map((row) => row.item_id),
          reviewer_ids: reviewerIds,
        },
        reason: text(input.instructions),
      });
      return get(actor, review.id, client);
    });
  };
  const mutate = async (actor, id, input, operation) =>
    transaction(async (client) => {
      const scopeRow = await get(actor, id, client);
      await lock(client, scopeRow.request_id);
      const review = await get(actor, id, client);
      if (
        review.status !== "IN_REVIEW" ||
        String(review.row_version) !== String(input.row_version)
      )
        throw error(409, "The review changed; reload before submitting");
      if (operation === "opinion") {
        const assignment = review.assignments.find(
          (row) => String(row.reviewer_id) === String(actor.id),
        );
        if (
          !assignment ||
          !["PENDING", "IN_PROGRESS"].includes(assignment.status)
        )
          throw error(
            403,
            "Only the assigned reviewer may submit this pending departmental opinion",
          );
        if (review.item_packets.some((p) => p.awaiting_proposal))
          throw error(
            409,
            "Procurement must prepare the proposed product and supporting evidence before review",
          );
        const reports = normalizeReports(input.reports, review.item_packets);
        if (
          reports.some((r) =>
            ["CONDITIONAL", "CLARIFICATION"].includes(r.decision),
          )
        )
          await profiles.requireSchema(client);
        const status = reports.every((row) => row.decision === "APPROVED")
          ? "APPROVED"
          : reports.some((row) => row.decision === "REJECTED")
            ? "REJECTED"
            : reports.some((row) => row.decision === "CLARIFICATION")
              ? "CLARIFICATION"
              : "CONDITIONAL";
        const submitted = await client.query(
          `UPDATE public.preprocurement_technical_review_assignments a SET status=$1,reports=$2::jsonb,submitted_by=u.id,submitted_at=now(),
        signature=jsonb_build_object('user_id',u.id,'name',u.name,'title',u.role,'department_id',u.department_id,'contact',COALESCE(u.phone_number,u.email),'signed_at',now())
        FROM public.users u WHERE a.id=$3 AND u.id=$4 AND u.id=a.reviewer_id AND ${reviewerScope("u", "a.department_id", "$5")} AND u.institute_id=$5 AND u.is_active IS TRUE`,
          [
            status,
            JSON.stringify(reports),
            assignment.id,
            actor.id,
            actor.institute_id,
          ],
        );
        if (!submitted.rowCount)
          throw error(
            409,
            "Reviewer department or account changed; ask SCM to reassign this review",
          );
        if (await profiles.installed(client)) {
          const signed = (
            await client.query(
              "SELECT * FROM preprocurement_technical_review_assignments WHERE id=$1",
              [assignment.id],
            )
          ).rows[0];
          await profiles.history(client, {
            actor,
            reviewId: id,
            action: "TECHNICAL_OPINION_ATTESTED",
            payload: { round: signed.opinion_round, assignment: signed },
          });
        }
        await client.query(
          "UPDATE public.preprocurement_technical_reviews SET row_version=row_version+1 WHERE id=$1",
          [id],
        );
        await notify(
          client,
          review.created_by,
          "Technical opinion submitted",
          `A departmental opinion is ready for request #${review.request_id}.`,
          id,
        );
      } else {
        manage(actor);
        if (!text(input.notes))
          throw error(400, "A decision reason is required");
        const status = operation === "cancel" ? "CANCELLED" : input.decision;
        if (!["APPROVED", "REJECTED", "CANCELLED"].includes(status))
          throw error(400, "Choose approve or reject");
        if (status === "CANCELLED" && operation !== "cancel")
          throw error(400, "Use the cancellation action");
        if (
          review.assignments.some(
            (row) => String(row.reviewer_id) === String(actor.id),
          )
        )
          throw error(
            403,
            "The SCM signatory cannot sign their own departmental opinion",
          );
        if (status === "APPROVED") {
          const currentRequest = (
            await client.query(
              "SELECT department_id FROM public.requests WHERE id=$1 AND institute_id=$2 AND lower(trim(status)) IN ('approved','partially procured','partially_procured')",
              [review.request_id, actor.institute_id],
            )
          ).rows[0];
          if (
            !currentRequest ||
            String(currentRequest.department_id) !==
              String(review.requesting_department_id)
          )
            throw error(
              409,
              "The request status or requesting department changed; review the request again",
            );
          if (review.assignments.some((row) => row.status !== "APPROVED"))
            throw error(
              409,
              "Every assigned department must approve before SCM technical clearance",
            );
          for(const packet of review.item_packets)if(packet.evidence)await require('./technicalProposalSnapshot').assertCurrent(client,packet.evidence,{supplier_id:packet.evidence.supplier_id,approved_product_id:packet.evidence.approved_product_id,source_type:packet.evidence.quotation_item_id?'QUOTATION':undefined,source_id:packet.evidence.quotation_item_id});
          const rows = (
            await client.query(
              "SELECT * FROM public.requested_items WHERE request_id=$1 AND id=ANY($2::int[])",
              [
                review.request_id,
                review.item_packets.map((packet) => packet.item_id),
              ],
            )
          ).rows;
          if (
            rows.length !== review.item_packets.length ||
            rows.some(
              (row) =>
                review.item_packets.find(
                  (packet) => String(packet.item_id) === String(row.id),
                ).fingerprint !== fingerprint(snapshotItem(row)),
            )
          )
            throw error(
              409,
              "Requested items changed; cancel this review and send a new round",
            );
        }
        const signed = await client.query(
          `UPDATE public.preprocurement_technical_reviews t SET status=$1,decision_notes=$2,signed_by=u.id,signed_at=now(),row_version=row_version+1,
        signer_snapshot=jsonb_build_object('user_id',u.id,'name',u.name,'title',u.role,'signed_at',now()) FROM public.users u WHERE t.id=$3 AND u.id=$4 AND u.institute_id=t.institute_id AND u.is_active IS TRUE`,
          [status, text(input.notes), id, actor.id],
        );
        if (!signed.rowCount)
          throw error(
            409,
            "SCM account or institute changed; reload before signing",
          );
        for (const userId of new Set([
          review.created_by,
          ...review.assignments.map((row) => row.reviewer_id),
        ]))
          await notify(
            client,
            userId,
            "Technical review decision",
            `Request #${review.request_id}: ${status.toLowerCase()}. ${text(input.notes, 500)}`,
            id,
          );
      }
      await writeAuditEvent({
        client,
        entityType: "preprocurement_technical_review",
        entityId: id,
        requestId: review.request_id,
        instituteId: actor.institute_id,
        actorUserId: actor.id,
        action:
          operation === "opinion"
            ? "TECHNICAL_OPINION_SUBMITTED"
            : operation === "cancel"
              ? "TECHNICAL_REVIEW_CANCELLED"
              : "TECHNICAL_REVIEW_SIGNED",
        reason: text(input.notes) || null,
        metadata: { row_version: review.row_version },
      });
      return get(actor, id, client);
    });
  const revise = async (actor, id, input) =>
    transaction(async (client) => {
      manage(actor);
      await profiles.requireSchema(client);
      const before = await get(actor, id, client);
      await lock(client, before.request_id);
      const review = await get(actor, id, client);
      if (
        review.status !== "IN_REVIEW" ||
        String(input.row_version) !== String(review.row_version) ||
        !text(input.notes)
      )
        throw error(
          409,
          "Reload the active review and provide a revision reason",
        );
      let packets = review.item_packets;
      if (input.items) {
        if (
          !Array.isArray(input.items) ||
          input.items.length !== packets.length
        )
          throw error(400, "Provide evidence for every existing item");
        packets = [];
        for (const old of review.item_packets) {
          const row = input.items.find(
            (i) => String(i.item_id) === String(old.item_id),
          );
          if (!row) throw error(400, "Revision must retain the reviewed items");
          const evidence = normalizeEvidence(row.evidence);
          await validateProposal(client, actor, evidence, old.item_id);
          if (old.assessment_policy?.pre_required && !evidence.supplier_id)
            throw error(
              400,
              "Select the actual proposed supplier before technical assessment",
            );
          if (
            old.awaiting_proposal &&
            evidence.basis !== "sample" &&
            evidence.no_sample_reason === old.evidence.no_sample_reason
          )
            throw error(
              400,
              "Record why a physical sample is unavailable for this proposal",
            );
          if (
            old.assessment_policy?.evidence_required &&
            !evidence.attachment_ids.length
          )
            throw error(
              400,
              "Supporting evidence is required by this technical policy",
            );
          const files = await client.query(
            "SELECT id FROM attachments WHERE request_id=$1 AND id=ANY($2::integer[])",
            [review.request_id, evidence.attachment_ids],
          );
          if (
            files.rows.length !==
            new Set(evidence.attachment_ids.map(String)).size
          )
            throw error(400, "Evidence must belong to this request");
          const current = (
            await client.query(
              "SELECT * FROM requested_items WHERE id=$1 AND request_id=$2",
              [old.item_id, review.request_id],
            )
          ).rows[0];
          if (!current) throw error(409, "Requested item changed");
          const snapshot = snapshotItem(current);
          packets.push({
            ...old,
            evidence,
            snapshot,
            fingerprint: fingerprint(snapshot),
            awaiting_proposal: false,
          });
        }
      } else if (packets.some((p) => p.awaiting_proposal))
        throw error(
          400,
          "Prepare the proposal and evidence before reopening review",
        );
      await profiles.retainEvidence(client, actor, id, null, [
        ...new Set(
          packets.flatMap((p) => p.evidence.attachment_ids).map(String),
        ),
      ]);
      await profiles.history(client, {
        actor,
        reviewId: id,
        action: "TECHNICAL_REVIEW_REVISED",
        payload: {
          notes: text(input.notes),
          before: {
            item_packets: review.item_packets,
            assignments: review.assignments,
          },
          after: { item_packets: packets },
        },
      });
      await client.query(
        "UPDATE preprocurement_technical_reviews SET item_packets=$2::jsonb,row_version=row_version+1 WHERE id=$1",
        [id, JSON.stringify(packets)],
      );
      await client.query(
        "UPDATE preprocurement_technical_review_assignments SET status='PENDING',reports='[]',submitted_by=NULL,submitted_at=NULL,signature=NULL,opinion_round=opinion_round+1 WHERE review_id=$1",
        [id],
      );
      for (const a of review.assignments)
        await notify(
          client,
          a.reviewer_id,
          "Technical review revised",
          text(input.notes, 500),
          id,
        );
      return get(actor, id, client);
    });
  const start = async (actor, id, input) =>
    transaction(async (client) => {
      await profiles.requireSchema(client);
      const before = await get(actor, id, client);
      await lock(client, before.request_id);
      const review = await get(actor, id, client);
      if (
        review.status !== "IN_REVIEW" ||
        String(input.row_version) !== String(review.row_version)
      )
        throw error(409, "Review changed; reload");
      const assignment = review.assignments.find(
        (a) => String(a.reviewer_id) === String(actor.id),
      );
      if (!assignment || assignment.status !== "PENDING")
        throw error(
          403,
          "Only the assigned pending reviewer may start this task",
        );
      await client.query(
        "UPDATE preprocurement_technical_review_assignments SET status='IN_PROGRESS' WHERE id=$1",
        [assignment.id],
      );
      await client.query(
        "UPDATE preprocurement_technical_reviews SET row_version=row_version+1 WHERE id=$1",
        [id],
      );
      await profiles.history(client, {
        actor,
        reviewId: id,
        action: "TECHNICAL_REVIEW_STARTED",
        payload: { assignment_id: assignment.id },
      });
      return get(actor, id, client);
    });
  return {
    revise,
    start,
    policy,
    updatePolicy,
    directory,
    eligible,
    list,
    get,
    create,
    opinion: (actor, id, input) => mutate(actor, id, input, "opinion"),
    sign: (actor, id, input) => mutate(actor, id, input, "sign"),
    cancel: (actor, id, input) => mutate(actor, id, input, "cancel"),
  };
}
module.exports = { createTechnicalReviewService };
