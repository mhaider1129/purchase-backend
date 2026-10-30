"use strict";
const m = require("./surgicalConsignmentModel");
const { writeAuditEvent } = require("./auditService");
const { error, text, id } = m;
const HOD = `(lower(trim(u.role))='hod' OR EXISTS(SELECT 1 FROM public.organization_positions p JOIN public.organization_units ou ON ou.id=p.organization_unit_id WHERE p.user_id=u.id AND ou.department_id=u.department_id AND ou.institute_id=u.institute_id AND ou.is_active IS TRUE AND p.is_active IS TRUE AND p.position_type='DEPARTMENT_HEAD' AND (p.effective_from IS NULL OR p.effective_from<=current_date) AND (p.effective_to IS NULL OR p.effective_to>=current_date)))`;
function createSurgicalConsignmentService(database) {
  const scope = (a) => {
    if (!a?.id || !(Number(a.institute_id) > 0))
      throw error(403, "An active institute account is required");
  };
  const configured = async (db) => {
    if (
      !(
        await db.query(
          "SELECT to_regclass('public.surgical_consignment_cases') IS NOT NULL AS available",
        )
      ).rows[0]?.available
    )
      throw error(
        503,
        "Apply the complete SQL 051 surgical-consignment patch",
        "SURGICAL_CONSIGNMENT_SCHEMA_REQUIRED",
      );
    const missing = (
      await db.query(`
      SELECT required.table_name,required.column_name FROM (VALUES
        ('surgical_consignment_cases','institute_id'),('departments','institute_id'),
        ('users','institute_id'),('suppliers','institute_id'),
        ('organization_units','institute_id'),('requests','institute_id')
      ) AS required(table_name,column_name)
      LEFT JOIN information_schema.columns actual ON actual.table_schema='public'
        AND actual.table_name=required.table_name AND actual.column_name=required.column_name
      WHERE actual.column_name IS NULL ORDER BY required.table_name
    `)
    ).rows;
    if (missing.length) {
      const names = missing
        .map((column) => `public.${column.table_name}.${column.column_name}`)
        .join(", ");
      const remedy = missing.every(
        (column) => column.table_name === "suppliers",
      )
        ? "Apply the complete SQL 052 surgical-consignment supplier-scope compatibility patch."
        : "Restore the listed institute-scope columns using the existing backend schema reconciliation; do not assign or infer institute ownership automatically.";
      throw error(
        503,
        `Surgical consignment schema is incomplete: ${names}. ${remedy}`,
        "SURGICAL_CONSIGNMENT_SCHEMA_REQUIRED",
      );
    }
  };
  const tx = async (work) => {
    const db = await database.connect();
    try {
      await db.query("BEGIN");
      await configured(db);
      const out = await work(db);
      await db.query("COMMIT");
      return out;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  };
  const clinical = (a, c) =>
    m.scm(a) ||
    m.cmo(a) ||
    [
      c.created_by,
      c.surgeon_id,
      c.nurse_id,
      c.receiver_id,
      ...(c.approvals || []).map((p) => p.approver_id),
    ].some((v) => String(v) === String(a.id));
  const signature = async (db, a) => {
    const u = (
      await db.query(
        "SELECT id,name,role,department_id,email,phone_number FROM public.users WHERE id=$1 AND institute_id=$2 AND is_active IS TRUE",
        [a.id, a.institute_id],
      )
    ).rows[0];
    if (!u) throw error(403, "Account is no longer active in this institute");
    return {
      user_id: u.id,
      name: u.name,
      role: u.role,
      department_id: u.department_id,
      email: u.email,
      phone_number: u.phone_number,
    };
  };
  const event = async (db, a, c, action, notes, metadata = {}) => {
    await db.query(
      "INSERT INTO public.surgical_consignment_events(case_id,action,actor_id,signature,notes,metadata) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb)",
      [
        c.id,
        action,
        a.id,
        JSON.stringify(await signature(db, a)),
        notes,
        JSON.stringify(metadata),
      ],
    );
    await writeAuditEvent({
      client: db,
      entityType: "surgical_consignment",
      entityId: c.id,
      instituteId: c.institute_id,
      actorUserId: a.id,
      action,
      reason: `${action} SC-${c.id}`,
      metadata: { case_id: c.id, ...metadata },
    });
  };
  const notify = (db, userId, c, title) =>
    db.query(
      "INSERT INTO public.notifications(user_id,title,message,link,metadata) SELECT id,$2,$3,$4,$5::jsonb FROM public.users WHERE id=$1 AND institute_id=$6 AND is_active IS TRUE",
      [
        userId,
        title,
        `Surgical consignment SC-${c.id} needs your action.`,
        `/surgical-consignments?case=${c.id}`,
        JSON.stringify({ surgical_consignment_id: String(c.id) }),
        c.institute_id,
      ],
    );
  const get = async (a, caseId, db = database, { lock = false } = {}) => {
    scope(a);
    await configured(db);
    const c = (
      await db.query(
        `SELECT c.*,c.surgery_date::text AS surgery_date,c.procedure_event_date::text AS procedure_event_date,d.name AS department_name,surgeon.name AS surgeon_name,nurse.name AS nurse_name,receiver.name AS receiver_name FROM public.surgical_consignment_cases c JOIN public.departments d ON d.id=c.department_id AND d.institute_id=c.institute_id JOIN public.users surgeon ON surgeon.id=c.surgeon_id JOIN public.users nurse ON nurse.id=c.nurse_id JOIN public.users receiver ON receiver.id=c.receiver_id WHERE c.id=$1 AND c.institute_id=$2${lock ? " FOR UPDATE OF c" : ""}`,
        [id(caseId), a.institute_id],
      )
    ).rows[0];
    if (!c) throw error(404, "Consignment request not found");
    c.approvals = (
      await db.query(
        "SELECT a.*,u.name FROM public.surgical_consignment_approvals a JOIN public.users u ON u.id=a.approver_id WHERE a.case_id=$1 ORDER BY step",
        [c.id],
      )
    ).rows;
    const isClinical = clinical(a, c);
    if (!isClinical && !m.finance(a))
      throw error(404, "Consignment request not found");
    c.receipts = (
      await db.query(
        "SELECT r.*,r.received_date::text AS received_date FROM public.surgical_consignment_receipts r WHERE case_id=$1 ORDER BY id",
        [c.id],
      )
    ).rows;
    c.lines = (
      await db.query(
        "SELECT l.*,l.expiry_date::text AS expiry_date,r.confirmed_at,r.received_date::text AS received_date FROM public.surgical_consignment_receipt_lines l JOIN public.surgical_consignment_receipts r ON r.id=l.receipt_id WHERE r.case_id=$1 ORDER BY l.id",
        [c.id],
      )
    ).rows;
    c.usage = (
      await db.query(
        "SELECT u.* FROM public.surgical_consignment_usage_lines u JOIN public.surgical_consignment_receipt_lines l ON l.id=u.receipt_line_id JOIN public.surgical_consignment_receipts r ON r.id=l.receipt_id WHERE r.case_id=$1 ORDER BY u.receipt_line_id",
        [c.id],
      )
    ).rows;
    c.returns = (
      await db.query(
        "SELECT r.*,r.returned_date::text AS returned_date FROM public.surgical_consignment_returns r WHERE case_id=$1 ORDER BY id",
        [c.id],
      )
    ).rows;
    c.waivers = (
      await db.query(
        "SELECT * FROM public.surgical_consignment_waivers WHERE case_id=$1 ORDER BY id DESC",
        [c.id],
      )
    ).rows;
    c.attestations = (
      await db.query(
        "SELECT * FROM public.surgical_consignment_attestations WHERE case_id=$1 ORDER BY created_at",
        [c.id],
      )
    ).rows;
    c.billing_lines = (
      await db.query(
        "SELECT * FROM public.surgical_consignment_billing_lines WHERE case_id=$1 ORDER BY receipt_line_id",
        [c.id],
      )
    ).rows;
    if (c.billing_po_id) {
      const linked = (
        await db.query(
          "SELECT po.request_id,po.po_number FROM public.purchase_orders po JOIN public.requests r ON r.id=po.request_id WHERE po.id=$1 AND r.institute_id=$2",
          [c.billing_po_id, c.institute_id],
        )
      ).rows[0];
      c.billing_request_id = linked?.request_id || null;
      c.billing_po_number = linked?.po_number || null;
    }
    c.balance = [];
    if (c.usage.length === c.lines.length && c.lines.length) {
      try {
        c.balance = m.reconcile(c.lines, c.usage, c.returns, c.waivers);
      } catch (e) {
        c.reconciliation_error = e.message;
      }
    }
    c.amount = m.total(c.balance);
    c.surgery_date = String(
      c.surgery_date instanceof Date
        ? c.surgery_date.toISOString()
        : c.surgery_date,
    ).slice(0, 10);
    c.procedure_event_date = c.procedure_event_date
      ? String(
          c.procedure_event_date instanceof Date
            ? c.procedure_event_date.toISOString()
            : c.procedure_event_date,
        ).slice(0, 10)
      : null;
    if (!isClinical)
      return {
        id: c.id,
        status: c.status,
        supplier_id: c.supplier_id,
        supplier_name: c.supplier_name,
        currency: c.currency,
        amount: c.amount,
        billing_po_id: c.billing_po_id,
        billing_request_id: c.billing_request_id,
        billing_po_number: c.billing_po_number,
        billing_lines: c.billing_lines,
        balance: ["RECONCILED", "BILLING_LINKED", "CLOSED"].includes(c.status)
          ? c.balance.map((l) => ({
              receipt_line_id: l.receipt_line_id,
              billing_description: l.billing_description,
              billable_quantity: l.billable_quantity,
              unit_price: l.unit_price,
              line_amount: l.line_amount,
            }))
          : [],
        clinical_access: false,
        current_user_id: a.id,
      };
    c.files = (
      await db.query(
        "SELECT f.id,f.file_name,f.purpose,f.created_at,u.name AS uploaded_by_name FROM public.surgical_consignment_files f JOIN public.users u ON u.id=f.uploaded_by WHERE case_id=$1 ORDER BY f.id",
        [c.id],
      )
    ).rows;
    c.events = (
      await db.query(
        "SELECT * FROM public.surgical_consignment_events WHERE case_id=$1 ORDER BY id DESC",
        [c.id],
      )
    ).rows;
    return {
      ...c,
      clinical_access: true,
      can_scm: m.scm(a),
      current_user_id: a.id,
    };
  };
  const list = async (a, search = "") => {
    scope(a);
    await configured(database);
    return (
      await database.query(
        `SELECT c.id,c.status,c.created_at,c.surgery_date::text,c.supplier_name,d.name AS department_name,c.authorization_code,c.billing_po_id FROM public.surgical_consignment_cases c JOIN public.departments d ON d.id=c.department_id AND d.institute_id=c.institute_id WHERE c.institute_id=$1 AND ($2::boolean OR c.created_by=$3 OR c.surgeon_id=$3 OR c.nurse_id=$3 OR c.receiver_id=$3 OR EXISTS(SELECT 1 FROM public.surgical_consignment_approvals a WHERE a.case_id=c.id AND a.approver_id=$3)) AND (c.id::text ILIKE $4 OR c.supplier_name ILIKE $4 OR COALESCE(c.authorization_code,'') ILIKE $4 OR EXISTS(SELECT 1 FROM public.surgical_consignment_receipt_lines l JOIN public.surgical_consignment_receipts r ON r.id=l.receipt_id WHERE r.case_id=c.id AND (l.catalogue_code ILIKE $4 OR l.batch_number ILIKE $4 OR COALESCE(l.serial_number,'') ILIKE $4))) ORDER BY (c.status NOT IN ('CLOSED','CANCELLED','REJECTED')) DESC,c.id DESC LIMIT 100`,
        [
          a.institute_id,
          m.scm(a) || m.cmo(a) || m.finance(a),
          a.id,
          `%${String(search || "").slice(0, 150)}%`,
        ],
      )
    ).rows;
  };
  const options = async (a) => {
    scope(a);
    await configured(database);
    if (!m.canCreate(a))
      throw error(403, "Request-creation permission required");
    const departments = (
      await database.query(
        "SELECT id,name FROM public.departments WHERE institute_id=$1 AND ($2::boolean OR id=$3) ORDER BY name",
        [a.institute_id, m.scm(a), a.department_id],
      )
    ).rows;
    const users = (
      await database.query(
        `SELECT u.id,u.name,u.role,u.department_id,${HOD} AS is_department_manager FROM public.users u JOIN public.departments d ON d.id=u.department_id AND d.institute_id=u.institute_id WHERE u.institute_id=$1 AND u.is_active IS TRUE ORDER BY u.name`,
        [a.institute_id],
      )
    ).rows;
    const suppliers = (
      await database.query(
        "SELECT id,name FROM public.suppliers WHERE (institute_id=$1 OR institute_id IS NULL) AND lower(trim(COALESCE(status,''))) NOT IN ('inactive','suspended','blacklisted') ORDER BY name",
        [a.institute_id],
      )
    ).rows;
    return { departments, users, suppliers, reasons: m.REASONS };
  };
  const validateApprover = async (
    db,
    userId,
    role,
    departmentId,
    instituteId,
  ) => {
    const u = (
      await db.query(
        `SELECT u.id,u.role,u.department_id,${HOD} AS is_department_manager FROM public.users u JOIN public.departments d ON d.id=u.department_id AND d.institute_id=u.institute_id WHERE u.id=$1 AND u.institute_id=$2 AND u.is_active IS TRUE`,
        [userId, instituteId],
      )
    ).rows[0];
    if (
      !u ||
      (role === "DEPARTMENT_MANAGER" &&
        (!u.is_department_manager ||
          String(u.department_id) !== String(departmentId))) ||
      (role === "CMO" && m.role(u) !== "cmo") ||
      (role === "SCM" && m.role(u) !== "scm")
    )
      throw error(
        409,
        "The selected approval authority is not currently valid",
      );
  };
  const file = async (db, c, fileId, purpose) => {
    if (
      !(
        await db.query(
          "SELECT id FROM public.surgical_consignment_files WHERE id=$1 AND case_id=$2 AND purpose=$3",
          [id(fileId), c.id, purpose],
        )
      ).rows.length
    )
      throw error(
        400,
        `Attach a ${purpose.toLowerCase()} document to this consignment and select it as evidence`,
      );
  };
  const create = async (a, input) => {
    scope(a);
    if (!m.canCreate(a))
      throw error(403, "Request-creation permission required");
    const departmentId = id(input.department_id);
    if (!m.scm(a) && String(a.department_id) !== departmentId)
      throw error(403, "Create the request in your own surgical department");
    const assignments = ["surgeon_id", "nurse_id", "receiver_id"].map((k) =>
      id(input[k]),
    );
    if (new Set(assignments).size !== 3)
      throw error(400, "Assign distinct surgeon, nurse and receiver accounts");
    const approvers = ["manager_id", "cmo_id", "scm_id"].map((k) =>
      id(input[k]),
    );
    if (new Set(approvers).size !== 3 || approvers.includes(String(a.id)))
      throw error(
        400,
        "The department manager, CMO and SCM must be distinct, independent of the requester",
      );
    const items = input.requested_items;
    if (!Array.isArray(items) || !items.length || items.length > 100)
      throw error(400, "Request 1–100 item families / sets");
    const lines = items.map((i) => ({
      item_name: text(i.item_name, "Item name", 250),
      quantity: m.quantity(i.quantity, true),
      catalogue_code: text(i.catalogue_code, "Catalogue / family code", 250),
      functional_specs: text(i.functional_specs, "Functional specifications"),
    }));
    if (
      !Array.isArray(input.justification) ||
      !input.justification.length ||
      input.justification.some((r) => !m.REASONS.includes(r))
    )
      throw error(400, "Select a consignment justification");
    if (input.justification.includes("OTHER"))
      text(input.other_justification, "Other justification");
    const payload = {
      department_id: departmentId,
      surgery_date: m.date(input.surgery_date),
      patient_mrn: text(input.patient_mrn, "Patient MRN", 100),
      procedure_type: text(input.procedure_type, "Procedure", 500),
      surgeon_id: assignments[0],
      nurse_id: assignments[1],
      receiver_id: assignments[2],
      supplier_id: id(input.supplier_id),
      vendor_contact: text(input.vendor_contact, "Vendor contact", 250),
      agreement_reference: text(
        input.agreement_reference,
        "Vendor agreement / price-list reference",
        250,
      ),
      currency: text(input.currency, "Currency", 3).toUpperCase(),
      requested_items: lines,
      justification: input.justification,
      other_justification: input.other_justification || "",
      approvers,
    };
    if (!/^[A-Z]{3}$/.test(payload.currency))
      throw error(400, "Use a three-letter currency code");
    const key = text(input.submission_key, "Submission key", 128),
      fingerprint = m.hash(payload);
    return tx(async (db) => {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('surgical-consignment-key:'||$1::text||':'||$2,0))",
        [a.institute_id, key],
      );
      const prior = (
        await db.query(
          "SELECT id,payload_fingerprint FROM public.surgical_consignment_cases WHERE institute_id=$1 AND submission_key=$2",
          [a.institute_id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_fingerprint !== fingerprint)
          throw error(
            409,
            "Submission key was used with different request details",
          );
        return get(a, prior.id, db);
      }
      if (
        !(
          await db.query(
            "SELECT id FROM public.departments WHERE id=$1 AND institute_id=$2",
            [departmentId, a.institute_id],
          )
        ).rows.length
      )
        throw error(403, "Surgical department is outside your institute");
      const people = (
        await db.query(
          "SELECT id FROM public.users WHERE id=ANY($1::int[]) AND institute_id=$2 AND is_active IS TRUE",
          [assignments, a.institute_id],
        )
      ).rows;
      if (people.length !== 3)
        throw error(
          400,
          "All assigned clinical/receiving staff must be active in this institute",
        );
      for (let i = 0; i < 3; i++)
        await validateApprover(
          db,
          approvers[i],
          ["DEPARTMENT_MANAGER", "CMO", "SCM"][i],
          departmentId,
          a.institute_id,
        );
      const supplier = (
        await db.query(
          "SELECT id,name FROM public.suppliers WHERE id=$1 AND (institute_id=$2 OR institute_id IS NULL) AND lower(trim(COALESCE(status,''))) NOT IN ('inactive','suspended','blacklisted')",
          [payload.supplier_id, a.institute_id],
        )
      ).rows[0];
      if (!supplier) throw error(400, "Choose an eligible company");
      const c = (
        await db.query(
          "INSERT INTO public.surgical_consignment_cases(institute_id,department_id,created_by,surgery_date,patient_mrn,procedure_type,requester_snapshot,surgeon_id,nurse_id,receiver_id,supplier_id,supplier_name,vendor_contact,agreement_reference,currency,requested_items,justification,other_justification,submission_key,payload_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20) RETURNING *",
          [
            a.institute_id,
            departmentId,
            a.id,
            payload.surgery_date,
            payload.patient_mrn,
            payload.procedure_type,
            JSON.stringify(await signature(db, a)),
            ...assignments,
            payload.supplier_id,
            supplier.name,
            payload.vendor_contact,
            payload.agreement_reference,
            payload.currency,
            JSON.stringify(lines),
            JSON.stringify(payload.justification),
            payload.other_justification,
            key,
            fingerprint,
          ],
        )
      ).rows[0];
      for (let i = 0; i < 3; i++)
        await db.query(
          "INSERT INTO public.surgical_consignment_approvals(case_id,step,role,approver_id) VALUES($1,$2,$3,$4)",
          [c.id, i + 1, ["DEPARTMENT_MANAGER", "CMO", "SCM"][i], approvers[i]],
        );
      await event(
        db,
        a,
        c,
        "SURGICAL_CONSIGNMENT_REQUESTED",
        "F18 request submitted",
      );
      await notify(
        db,
        approvers[0],
        c,
        "Surgical consignment authorization requested",
      );
      return get(a, c.id, db);
    });
  };
  const mutate = async (a, caseId, input, operation) =>
    tx(async (db) => {
      // PO-first ordering matches invoice/receipt transaction locks; no case-first PO lock cycle.
      let po = null;
      if (operation === "bind_po") {
        if (!m.scm(a)) throw error(403, "SCM authority required");
        po = (
          await db.query(
            "SELECT po.* FROM public.purchase_orders po JOIN public.requests r ON r.id=po.request_id WHERE po.id=$1 AND r.institute_id=$2 FOR UPDATE OF po",
            [id(input.purchase_order_id), a.institute_id],
          )
        ).rows[0];
        if (!po)
          throw error(404, "Issued purchase order not found in this institute");
      }
      const c = await get(a, caseId, db, { lock: true });
      if (!c.clinical_access)
        throw error(403, "Clinical assignment or SCM authority required");
      if (String(input.row_version) !== String(c.row_version))
        throw error(
          409,
          "Consignment changed; reload before submitting",
          "SURGICAL_CONSIGNMENT_VERSION_CONFLICT",
        );
      const notes = text(input.notes, "Action notes");
      const isScm = m.scm(a);
      const signed = await signature(db, a);
      let metadata = {};
      if (operation === "approve") {
        if (c.status !== "AWAITING_AUTHORIZATION")
          throw error(409, "This authorization round is no longer pending");
        const step = c.approvals.find((p) => p.status === "PENDING");
        if (!step || String(step.approver_id) !== String(a.id))
          throw error(
            403,
            "Only the current assigned authority may decide this step",
          );
        await validateApprover(
          db,
          a.id,
          step.role,
          c.department_id,
          c.institute_id,
        );
        if (!["APPROVED", "REJECTED"].includes(input.decision))
          throw error(400, "Approve or reject the request");
        if (input.decision === "APPROVED" && step.role === "SCM") {
          if (input.acknowledge_vendor_ownership !== true)
            throw error(
              400,
              "Acknowledge vendor ownership and usage-only billing",
            );
          await file(db, c, input.agreement_file_id, "AGREEMENT");
        }
        await db.query(
          "UPDATE public.surgical_consignment_approvals SET status=$1,notes=$2,signature=$3::jsonb,decided_at=now() WHERE case_id=$4 AND step=$5",
          [input.decision, notes, JSON.stringify(signed), c.id, step.step],
        );
        if (input.decision === "REJECTED") c.status = "REJECTED";
        else if (step.step === 3) {
          c.status = "AUTHORIZED";
          c.authorization_code = `SCN-${c.institute_id}-${c.id}`;
          await notify(
            db,
            c.receiver_id,
            c,
            "Surgical consignment authorized for temporary receipt",
          );
        } else
          await notify(
            db,
            c.approvals.find((p) => p.step === step.step + 1).approver_id,
            c,
            "Surgical consignment authorization requested",
          );
        metadata = { step: step.step, decision: input.decision };
      } else if (operation === "receipt") {
        if (
          String(a.id) !== String(c.receiver_id) ||
          !["AUTHORIZED", "RECEIVED"].includes(c.status)
        )
          throw error(
            403,
            "The assigned receiver may record temporary deliveries only after authorization",
          );
        if (
          input.vendor_ownership_acknowledged !== true ||
          input.terms_acknowledged !== true
        )
          throw error(
            400,
            "Acknowledge temporary vendor ownership and signed consignment terms",
          );
        await file(db, c, input.evidence_file_id, "RECEIPT");
        const receivedDate = m.date(input.received_date);
        if (receivedDate > m.today())
          throw error(400, "Receipt date cannot be in the future");
        if (
          !Array.isArray(input.lines) ||
          !input.lines.length ||
          input.lines.length > 200
        )
          throw error(400, "Record 1–200 delivered lots");
        const receipt = (
          await db.query(
            "INSERT INTO public.surgical_consignment_receipts(case_id,received_date,location,delivery_reference,vendor_representative,vendor_contact,receiver_id,receiver_signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id",
            [
              c.id,
              receivedDate,
              text(input.location, "Receiving location", 250),
              text(
                input.delivery_reference,
                "Delivery / manifest reference",
                250,
              ),
              text(input.vendor_representative, "Vendor representative", 250),
              text(input.vendor_contact, "Vendor contact", 250),
              a.id,
              JSON.stringify(signed),
            ],
          )
        ).rows[0];
        for (const l of input.lines) {
          const family = m.quantity(l.requested_item_index);
          if (family >= c.requested_items.length)
            throw error(
              400,
              "Choose an authorized item family for every delivered lot",
            );
          const expiry = m.date(l.expiry_date);
          if (typeof l.sterile_intact !== "boolean")
            throw error(
              400,
              "Record packaging / sterility inspection for each lot",
            );
          const accepted =
            l.sterile_intact &&
            expiry >= c.surgery_date &&
            expiry >= receivedDate;
          await db.query(
            "INSERT INTO public.surgical_consignment_receipt_lines(receipt_id,requested_item_index,item_name,catalogue_code,batch_number,serial_number,expiry_date,delivered_quantity,unit_price,sterile_intact,accepted,inspection_notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            [
              receipt.id,
              family,
              text(l.item_name, "Item", 250),
              text(l.catalogue_code, "Exact catalogue / size code", 250),
              text(l.batch_number, "Batch / lot", 250),
              l.serial_number || null,
              expiry,
              m.quantity(l.delivered_quantity, true),
              m.price(l.unit_price),
              l.sterile_intact,
              accepted,
              text(l.inspection_notes, "Inspection findings"),
            ],
          );
        }
        metadata = {
          receipt_id: receipt.id,
          file_id: String(input.evidence_file_id),
        };
        await notify(
          db,
          c.approvals[2].approver_id,
          c,
          "Temporary consignment receipt needs SCM confirmation",
        );
      } else if (operation === "confirm_receipt") {
        if (!isScm || !["AUTHORIZED", "RECEIVED"].includes(c.status))
          throw error(403, "SCM confirmation is required");
        const r = c.receipts.find((r) => String(r.id) === id(input.receipt_id));
        if (!r || r.confirmed_at)
          throw error(409, "Receipt is missing or already confirmed");
        await db.query(
          "UPDATE public.surgical_consignment_receipts SET confirmed_by=$1,scm_signature=$2::jsonb,confirmed_at=now() WHERE id=$3",
          [a.id, JSON.stringify(signed), r.id],
        );
        c.status = "RECEIVED";
        metadata = { receipt_id: r.id };
      } else if (operation === "save_usage") {
        if (
          String(a.id) !== String(c.nurse_id) ||
          !["RECEIVED", "RECONCILING"].includes(c.status)
        )
          throw error(
            403,
            "Only the assigned nurse can prepare usage before attestation",
          );
        if (c.receipts.some((r) => !r.confirmed_at))
          throw error(409, "SCM must confirm every temporary receipt first");
        const outcome = input.procedure_outcome || "PERFORMED";
        if (!["PERFORMED", "CANCELLED", "POSTPONED"].includes(outcome))
          throw error(400, "Record the procedure outcome");
        const performed = m.date(input.procedure_event_date);
        if (performed > m.today())
          throw error(
            400,
            "Record usage after the operation, not a future surgery",
          );
        if (
          !Array.isArray(input.lines) ||
          input.lines.length !== c.lines.length ||
          new Set(input.lines.map((l) => String(l.receipt_line_id))).size !==
            c.lines.length
        )
          throw error(
            400,
            "Account for every delivered lot, including zero usage",
          );
        const usage = input.lines.map((l) => ({
          receipt_line_id: id(l.receipt_line_id),
          used_quantity: m.quantity(l.used_quantity),
          damaged_quantity: m.quantity(l.damaged_quantity),
          missing_quantity: m.quantity(l.missing_quantity),
          notes: text(l.notes, "Lot usage / discrepancy notes"),
        }));
        if (
          usage.some(
            (u) => !c.lines.some((l) => String(l.id) === u.receipt_line_id),
          )
        )
          throw error(400, "Usage contains a lot outside this case");
        if (outcome !== "PERFORMED" && usage.some((l) => l.used_quantity > 0))
          throw error(
            400,
            "A cancelled/postponed procedure cannot have implanted/used quantities",
          );
        m.reconcile(c.lines, usage, c.returns, c.waivers);
        if (c.lines.some((l) => l.received_date > performed))
          throw error(400, "The surgery date cannot precede delivery");
        for (const u of usage)
          await db.query(
            "INSERT INTO public.surgical_consignment_usage_lines(receipt_line_id,used_quantity,damaged_quantity,missing_quantity,notes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(receipt_line_id) DO UPDATE SET used_quantity=EXCLUDED.used_quantity,damaged_quantity=EXCLUDED.damaged_quantity,missing_quantity=EXCLUDED.missing_quantity,notes=EXCLUDED.notes",
            [
              u.receipt_line_id,
              u.used_quantity,
              u.damaged_quantity,
              u.missing_quantity,
              u.notes,
            ],
          );
        c.procedure_event_date = performed;
        c.procedure_outcome = outcome;
        c.status = "RECONCILING";
      } else if (operation === "return") {
        if (
          String(a.id) !== String(c.receiver_id) ||
          c.status !== "RECONCILING"
        )
          throw error(
            403,
            "The assigned receiver records unused returns during reconciliation",
          );
        await file(db, c, input.evidence_file_id, "RETURN");
        const line = c.lines.find(
          (l) => String(l.id) === id(input.receipt_line_id),
        );
        if (!line) throw error(404, "Delivered lot not found");
        if (!["INTACT", "DAMAGED"].includes(input.kind))
          throw error(400, "Return intact or damaged items");
        const date = m.date(input.returned_date);
        if (date < m.date(c.procedure_event_date) || date > m.today())
          throw error(
            400,
            "Return date must be after surgery and not in the future",
          );
        const qty = m.quantity(input.quantity, true);
        if (input.kind === "INTACT" && !line.sterile_intact)
          throw error(
            409,
            "Compromised packaging requires a damaged return and explicit vendor no-charge resolution",
          );
        const proposed = [
          ...c.returns,
          { receipt_line_id: line.id, kind: input.kind, quantity: qty },
        ];
        m.reconcile(c.lines, c.usage, proposed, c.waivers);
        if (
          input.kind === "DAMAGED" &&
          c.waivers.some((w) => String(w.receipt_line_id) === String(line.id))
        )
          throw error(
            409,
            "A disposal/waiver is already documented; do not return disposed quantities",
          );
        await db.query(
          "INSERT INTO public.surgical_consignment_returns(case_id,receipt_line_id,kind,quantity,returned_date,vendor_representative,actor_id,signature,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)",
          [
            c.id,
            line.id,
            input.kind,
            qty,
            date,
            text(
              input.vendor_representative,
              "Receiving vendor representative",
              250,
            ),
            a.id,
            JSON.stringify(signed),
            notes,
          ],
        );
        metadata = {
          receipt_line_id: line.id,
          file_id: String(input.evidence_file_id),
        };
      } else if (operation === "waiver") {
        if (
          !isScm ||
          c.status !== "RECONCILING" ||
          input.vendor_no_charge !== true
        )
          throw error(
            403,
            "SCM may resolve an exception only with documented vendor no-charge agreement",
          );
        await file(db, c, input.evidence_file_id, "WAIVER");
        const line = m
          .reconcile(c.lines, c.usage, c.returns, c.waivers)
          .find((l) => String(l.receipt_line_id) === id(input.receipt_line_id));
        if (!line || (!line.damaged_quantity && !line.missing_quantity))
          throw error(400, "Choose a damaged or missing-item exception");
        const disposed = line.damaged_quantity - line.returned_damaged;
        if (disposed > 0 && input.vendor_disposal_authorized !== true)
          throw error(
            400,
            "Unreturned damaged items require vendor-authorized disposal evidence",
          );
        await db.query(
          "INSERT INTO public.surgical_consignment_waivers(case_id,receipt_line_id,usage_fingerprint,disposed_quantity,vendor_no_charge,actor_id,signature,notes) VALUES($1,$2,$3,$4,true,$5,$6::jsonb,$7)",
          [
            c.id,
            line.receipt_line_id,
            m.usageFingerprint(line),
            disposed,
            a.id,
            JSON.stringify(signed),
            notes,
          ],
        );
        metadata = {
          receipt_line_id: line.receipt_line_id,
          file_id: String(input.evidence_file_id),
        };
      } else if (operation === "attest") {
        let role = null;
        if (String(a.id) === String(c.nurse_id)) role = "NURSE";
        else if (String(a.id) === String(c.surgeon_id)) role = "SURGEON";
        else if (String(a.id) === String(c.receiver_id)) role = "RECEIVER";
        if (
          !role ||
          input.confirm_quantities !== true ||
          input.vendor_informed !== true ||
          input.acknowledge_used_billing !== true
        )
          throw error(
            403,
            "Assigned staff must attest quantities, vendor notification and usage-only billing",
          );
        if (c.attestations.some((s) => s.role === role))
          throw error(409, "Your attestation is already recorded");
        if (role === "NURSE") {
          if (c.status !== "RECONCILING")
            throw error(409, "Reconcile usage and returns before signing F20");
          const snapshot = m.ready(c.lines, c.usage, c.returns, c.waivers);
          c.usage_snapshot = {
            procedure_event_date: c.procedure_event_date,
            procedure_outcome: c.procedure_outcome,
            lines: snapshot,
            total: m.total(snapshot),
            currency: c.currency,
            vendor_informed: true,
          };
          c.status = "USAGE_REVIEW";
        } else if (c.status !== "USAGE_REVIEW")
          throw error(
            409,
            "The nurse must first freeze and attest the reconciled usage record",
          );
        await db.query(
          "INSERT INTO public.surgical_consignment_attestations(case_id,role,actor_id,signature,notes) VALUES($1,$2,$3,$4::jsonb,$5)",
          [c.id, role, a.id, JSON.stringify(signed), notes],
        );
        if (role === "NURSE") {
          await notify(
            db,
            c.surgeon_id,
            c,
            "F20 usage confirmation needs your signature",
          );
          await notify(
            db,
            c.receiver_id,
            c,
            "F20 usage confirmation needs your signature",
          );
        }
        if (
          c.attestations.filter((s) =>
            ["NURSE", "SURGEON", "RECEIVER"].includes(s.role),
          ).length +
            1 ===
          3
        ) {
          c.status = "USAGE_CONFIRMED";
          await notify(
            db,
            c.approvals[2].approver_id,
            c,
            "Surgical consignment ready for SCM reconciliation",
          );
        }
      } else if (operation === "release_billing") {
        if (!isScm || c.status !== "USAGE_CONFIRMED")
          throw error(
            403,
            "SCM can release billing only after all three F20 attestations",
          );
        await db.query(
          "INSERT INTO public.surgical_consignment_attestations(case_id,role,actor_id,signature,notes) VALUES($1,'SCM_RECONCILIATION',$2,$3::jsonb,$4)",
          [c.id, a.id, JSON.stringify(signed), notes],
        );
        c.status = "RECONCILED";
      } else if (operation === "bind_po") {
        if (
          c.status !== "RECONCILED" ||
          !po ||
          po.status !== "PO_ISSUED" ||
          String(po.supplier_id) !== String(c.supplier_id) ||
          po.currency.trim() !== c.currency.trim()
        )
          throw error(
            409,
            "Use a newly issued PO for the confirmed used quantities, same company and currency",
          );
        const downstream = (
          await db.query(
            "SELECT EXISTS(SELECT 1 FROM public.goods_receipts WHERE purchase_order_id=$1) OR EXISTS(SELECT 1 FROM public.supplier_invoices WHERE purchase_order_id=$1) AS started",
            [po.id],
          )
        ).rows[0];
        if (downstream.started)
          throw error(
            409,
            "Bind the PO before any ordinary receipt or invoice is entered",
          );
        const bill = c.usage_snapshot.lines.filter(
          (l) => l.billable_quantity > 0,
        );
        const poLines = (
          await db.query(
            "SELECT * FROM public.purchase_order_items WHERE purchase_order_id=$1 ORDER BY id FOR UPDATE",
            [po.id],
          )
        ).rows;
        if (
          !Array.isArray(input.mappings) ||
          input.mappings.length !== bill.length ||
          poLines.length !== bill.length ||
          new Set(input.mappings.map((l) => String(l.purchase_order_item_id)))
            .size !== bill.length ||
          new Set(input.mappings.map((l) => String(l.receipt_line_id))).size !==
            bill.length
        )
          throw error(
            400,
            "Map every used lot to exactly one dedicated PO line; no unused lines are allowed",
          );
        for (const mapping of input.mappings) {
          const line = bill.find(
              (l) => String(l.receipt_line_id) === id(mapping.receipt_line_id),
            ),
            p = poLines.find(
              (p) => String(p.id) === id(mapping.purchase_order_item_id),
            );
          let identityMatches = Boolean(
            line && p && String(p.item_name) === line.billing_description,
          );
          if (line && p?.supplier_catalog_item_id) {
            const catalogue = (
              await db.query(
                "SELECT supplier_item_code,supplier_id,approved_product_id FROM public.supplier_catalog_items WHERE id=$1",
                [p.supplier_catalog_item_id],
              )
            ).rows[0];
            identityMatches = Boolean(
              catalogue &&
              String(catalogue.supplier_id) === String(c.supplier_id) &&
              String(catalogue.approved_product_id) ===
                String(p.approved_product_id) &&
              String(catalogue.supplier_item_code) ===
                String(line.catalogue_code),
            );
          }
          if (
            !line ||
            !p ||
            p.line_type !== "NON_INVENTORY" ||
            m.compareDecimal(p.quantity, line.billable_quantity) !== 0 ||
            m.compareDecimal(p.unit_price, line.unit_price) !== 0 ||
            m.compareDecimal(p.conversion_factor || 0, 1) !== 0 ||
            !identityMatches
          )
            throw error(
              409,
              "PO descriptions, quantities, rates and one-piece conversion must exactly match the usage packet; use NON_INVENTORY lines",
            );
          await db.query(
            "INSERT INTO public.surgical_consignment_billing_lines(case_id,receipt_line_id,purchase_order_item_id,used_quantity,unit_price) VALUES($1,$2,$3,$4,$5)",
            [
              c.id,
              line.receipt_line_id,
              p.id,
              line.billable_quantity,
              line.unit_price,
            ],
          );
        }
        c.billing_po_id = po.id;
        c.status = "BILLING_LINKED";
        metadata = { purchase_order_id: po.id };
      } else if (operation === "close") {
        if (
          !isScm ||
          !["RECONCILED", "BILLING_LINKED"].includes(c.status) ||
          (c.status === "RECONCILED" &&
            c.usage_snapshot.lines.some((l) => l.billable_quantity > 0))
        )
          throw error(
            409,
            "Reconcile the case and link a used-items PO first, or close a completely unused returned consignment",
          );
        c.status = "CLOSED";
      } else if (operation === "cancel") {
        if (
          !isScm ||
          c.receipts.length ||
          !["AWAITING_AUTHORIZATION", "AUTHORIZED"].includes(c.status)
        )
          throw error(
            409,
            "Cancel only before physical delivery; delivered stock must be reconciled",
          );
        c.status = "CANCELLED";
      } else throw error(400, "Unknown consignment action");
      await db.query(
        "UPDATE public.surgical_consignment_cases SET status=$1,authorization_code=$2,procedure_event_date=$3,usage_snapshot=$4::jsonb,billing_po_id=$5,procedure_outcome=$7,row_version=row_version+1 WHERE id=$6",
        [
          c.status,
          c.authorization_code,
          c.procedure_event_date,
          JSON.stringify(c.usage_snapshot),
          c.billing_po_id,
          c.id,
          c.procedure_outcome,
        ],
      );
      await event(
        db,
        a,
        c,
        `SURGICAL_CONSIGNMENT_${operation.toUpperCase()}`,
        notes,
        metadata,
      );
      return get(a, c.id, db);
    });
  const attach = async (a, caseId, info) =>
    tx(async (db) => {
      const c = await get(a, caseId, db, { lock: true });
      if (!c.clinical_access)
        throw error(
          403,
          "Only assigned clinical/SCM staff can attach clinical documents",
        );
      if (!m.PURPOSES.includes(info.purpose))
        throw error(400, "Choose the form/document purpose");
      const f = (
        await db.query(
          "INSERT INTO public.surgical_consignment_files(case_id,file_name,storage_name,purpose,uploaded_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [c.id, info.file_name, info.storage_name, info.purpose, a.id],
        )
      ).rows[0];
      await db.query(
        "UPDATE public.surgical_consignment_cases SET row_version=row_version+1 WHERE id=$1",
        [c.id],
      );
      await event(
        db,
        a,
        c,
        "SURGICAL_CONSIGNMENT_FILE_ATTACHED",
        "Clinical document attached",
        { file_id: f.id, purpose: info.purpose },
      );
      return get(a, c.id, db);
    });
  const download = async (a, caseId, fileId) => {
    const c = await get(a, caseId);
    if (!c.clinical_access)
      throw error(
        403,
        "Clinical document access requires an explicit assignment",
      );
    const f = (
      await database.query(
        "SELECT file_name,storage_name FROM public.surgical_consignment_files WHERE id=$1 AND case_id=$2",
        [id(fileId), c.id],
      )
    ).rows[0];
    if (!f) throw error(404, "File not found");
    await writeAuditEvent({
      entityType: "surgical_consignment",
      entityId: c.id,
      actorUserId: a.id,
      instituteId: a.institute_id,
      action: "SURGICAL_CONSIGNMENT_FILE_DOWNLOADED",
      metadata: { file_id: String(fileId) },
      client: database,
    });
    return f;
  };
  const poOptions = async (a, caseId) => {
    const c = await get(a, caseId);
    if (!m.scm(a)) throw error(403, "SCM authority required");
    return (
      await database.query(
        "SELECT po.id,po.po_number,po.currency,po.supplier_id,jsonb_agg(jsonb_build_object('id',l.id,'item_name',l.item_name,'quantity',l.quantity,'unit_price',l.unit_price) ORDER BY l.id) AS lines FROM public.purchase_orders po JOIN public.requests r ON r.id=po.request_id JOIN public.purchase_order_items l ON l.purchase_order_id=po.id WHERE r.institute_id=$1 AND po.supplier_id=$2 AND po.status='PO_ISSUED' GROUP BY po.id ORDER BY po.id DESC LIMIT 100",
        [a.institute_id, c.supplier_id],
      )
    ).rows;
  };
  const read = async (a, caseId) => {
    const c = await get(a, caseId);
    await writeAuditEvent({
      client: database,
      entityType: "surgical_consignment",
      entityId: c.id,
      instituteId: a.institute_id,
      actorUserId: a.id,
      action: "SURGICAL_CONSIGNMENT_VIEWED",
      metadata: { clinical_access: c.clinical_access },
    });
    return c;
  };
  return {
    checkSchema: () => configured(database),
    create,
    get,
    read,
    list,
    options,
    mutate,
    attach,
    download,
    poOptions,
  };
}
module.exports = { createSurgicalConsignmentService };
