"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  createSurgicalConsignmentService,
} = require("../services/surgicalConsignmentService");
const {
  createTransactionalP2PRepository,
} = require("../repositories/connectedP2PRepository");
const {
  submitSupplierInvoice,
  runInvoiceMatch,
} = require("../services/supplierInvoiceService");
const { createGoodsReceipt } = require("../services/goodsReceiptService");
const m = require("../services/surgicalConsignmentModel");
module.exports = async (client) => {
  assert.equal(client.connectionParameters.host, "127.0.0.1");
  assert.equal(client.connectionParameters.user, "p2p_test");
  const ddl = fs.readFileSync(
    path.join(__dirname, "../sql/manual/051_surgical_consignment.sql"),
    "utf8",
  );
  await client.query(ddl);
  await client.query(ddl);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'surgical_consignment_%' AND relrowsecurity",
      )
    ).rows[0].n,
    11,
  );
  await client.query("BEGIN");
  let point = 0,
    failNotification = false;
  const adapter = {
    release: () => {},
    query: async (sql, args) => {
      if (sql === "BEGIN") return client.query(`SAVEPOINT surgical_${++point}`);
      if (sql === "COMMIT")
        return client.query(`RELEASE SAVEPOINT surgical_${point}`);
      if (sql === "ROLLBACK") {
        await client.query(`ROLLBACK TO SAVEPOINT surgical_${point}`);
        return client.query(`RELEASE SAVEPOINT surgical_${point}`);
      }
      if (
        failNotification &&
        sql.startsWith("INSERT INTO public.notifications")
      ) {
        failNotification = false;
        throw new Error("Surgical notification failure");
      }
      try {
        return await client.query(sql, args);
      } catch (e) {
        e.message += ` [surgical fixture SQL: ${sql.slice(0, 110)}]`;
        throw e;
      }
    },
  };
  const pool = { query: adapter.query, connect: async () => adapter },
    service = createSurgicalConsignmentService(pool),
    repo = createTransactionalP2PRepository(pool);
  try {
    const institute = async (name) =>
      (
        await client.query(
          "INSERT INTO public.institutes(id,name) SELECT COALESCE(max(id),0)+100,$1 FROM public.institutes RETURNING id",
          [name],
        )
      ).rows[0].id;
    const inst = await institute("Surgical fixture"),
      other = await institute("Other surgical fixture");
    const dept = async (name, i = inst) =>
      (
        await client.query(
          "INSERT INTO public.departments(id,name,type,institute_id) SELECT COALESCE(max(id),0)+100,$1,'Medical',$2 FROM public.departments RETURNING id",
          [name, i],
        )
      ).rows[0].id;
    const department = await dept("Surgical fixture"),
      foreignDept = await dept("Other surgical department", other);
    const user = async (name, role, d = department, i = inst) => {
      const u = (
        await client.query(
          "INSERT INTO public.users(id,name,email,password,role,department_id,institute_id,is_active) SELECT COALESCE(max(id),0)+100,$1,$2,'test',$3,$4,$5,true FROM public.users RETURNING *",
          [name, name.replaceAll(" ", "") + "@surgical.invalid", role, d, i],
        )
      ).rows[0];
      return {
        ...u,
        permissions:
          role === "Finance"
            ? ["finance.verify"]
            : role === "Requester"
              ? ["stock-requests.create"]
              : role === "SCM"
                ? ["requests.manage", "procurement.update-status"]
                : [],
      };
    };
    const requester = await user("Surgical requester", "Requester"),
      hod = await user("Surgical manager", "HOD"),
      cmo = await user("Surgical CMO", "CMO"),
      scm = await user("Surgical SCM", "SCM"),
      surgeon = await user("Surgical surgeon", "Requester"),
      nurse = await user("Surgical nurse", "Requester"),
      receiver = await user("Surgical receiver", "WarehouseKeeper"),
      finance = await user("Surgical finance", "Finance"),
      outsider = await user("Surgical outsider", "Requester"),
      foreign = await user("Other surgical SCM", "SCM", foreignDept, other);
    const supplier = (
      await client.query(
        "INSERT INTO public.suppliers(name,status,institute_id) VALUES('Surgical fixture vendor','active',$1) RETURNING id",
        [inst],
      )
    ).rows[0].id;
    const seed = {
      department_id: department,
      surgery_date: m.today(),
      patient_mrn: "TEST-MRN-ONLY",
      procedure_type: "Synthetic test procedure",
      surgeon_id: surgeon.id,
      nurse_id: nurse.id,
      receiver_id: receiver.id,
      supplier_id: supplier,
      vendor_contact: "Fixture contact",
      agreement_reference: "Fixture agreed price list",
      currency: "IQD",
      manager_id: hod.id,
      cmo_id: cmo.id,
      scm_id: scm.id,
      requested_items: [
        {
          item_name: "Plate / screw range",
          quantity: 20,
          catalogue_code: "FAMILY-1",
          functional_specs: "Assorted sizes as clinically needed",
        },
      ],
      justification: ["PATIENT_SPECIFIC"],
      submission_key: "surgical-fixture",
    };
    // Exercise the deployed legacy schema, not just the reconciled snapshot:
    // the old supplier creator has no institute_id column.
    const supplierPatch = fs
      .readFileSync(
        path.join(
          __dirname,
          "../sql/manual/052_surgical_consignment_supplier_scope_compatibility.sql",
        ),
        "utf8",
      )
      .replace(/^BEGIN;$/m, "")
      .replace(/^COMMIT;$/m, "");
    await client.query("SAVEPOINT supplier_scope_compatibility_fixture");
    const foreignSupplier = (
      await client.query(
        "INSERT INTO public.suppliers(name,status,institute_id) VALUES('Other institute vendor','active',$1) RETURNING id",
        [other],
      )
    ).rows[0].id;
    const inactiveSupplier = (
      await client.query(
        "INSERT INTO public.suppliers(name,status) VALUES('Suspended vendor','suspended') RETURNING id",
      )
    ).rows[0].id;
    const originalSuppliers = (
      await client.query("SELECT * FROM public.suppliers ORDER BY id")
    ).rows;
    await client.query(supplierPatch);
    await client.query(supplierPatch);
    assert.deepEqual(
      (await client.query("SELECT * FROM public.suppliers ORDER BY id")).rows,
      originalSuppliers,
    );
    const modernOptions = await service.options(scm);
    assert(
      modernOptions.suppliers.some(
        (row) => Number(row.id) === Number(supplier),
      ),
    );
    assert(
      !modernOptions.suppliers.some(
        (row) => Number(row.id) === Number(foreignSupplier),
      ),
    );
    assert(
      !modernOptions.suppliers.some(
        (row) => Number(row.id) === Number(inactiveSupplier),
      ),
    );
    await assert.rejects(
      service.create(requester, {
        ...seed,
        submission_key: "foreign-supplier-scope",
        supplier_id: foreignSupplier,
      }),
      { statusCode: 400 },
    );
    await client.query("ALTER TABLE public.suppliers DROP COLUMN institute_id");
    await assert.rejects(
      service.options(scm),
      (error) =>
        error.code === "SURGICAL_CONSIGNMENT_SCHEMA_REQUIRED" &&
        error.message.includes("public.suppliers.institute_id") &&
        error.message.includes("SQL 052"),
    );
    await client.query(supplierPatch);
    await client.query(supplierPatch);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM public.suppliers WHERE institute_id IS NOT NULL",
        )
      ).rows[0].n,
      0,
    );
    assert(
      (await service.options(scm)).suppliers.some(
        (row) => Number(row.id) === Number(supplier),
      ),
    );
    assert.equal(
      (
        await service.create(requester, {
          ...seed,
          submission_key: "legacy-supplier-scope",
        })
      ).status,
      "AWAITING_AUTHORIZATION",
    );
    await client.query(
      "ROLLBACK TO SAVEPOINT supplier_scope_compatibility_fixture",
    );
    console.log(
      "SQL 052 supplier scope: reproduce missing-column preflight, populated/repeat preservation, NULL legacy directory semantics, tenant/status exclusion and actual F18 create after patch PASS",
    );
    let c = await service.create(requester, seed);
    assert.equal(c.status, "AWAITING_AUTHORIZATION");
    assert.equal((await service.create(requester, seed)).id, c.id);
    await assert.rejects(
      service.create(requester, { ...seed, patient_mrn: "Different" }),
      { statusCode: 409 },
    );
    await assert.rejects(service.get(outsider, c.id), { statusCode: 404 });
    await assert.rejects(service.get(foreign, c.id), { statusCode: 404 });
    const financeView = await service.get(finance, c.id);
    assert.equal(financeView.clinical_access, false);
    assert(!JSON.stringify(financeView).includes("TEST-MRN"));
    assert(!("files" in financeView));
    const mutate = async (a, op, fields = {}) => {
      c = await service.mutate(
        a,
        c.id,
        { row_version: c.row_version, notes: "Fixture action", ...fields },
        op,
      );
      return c;
    };
    await assert.rejects(mutate(cmo, "approve", { decision: "APPROVED" }), {
      statusCode: 403,
    });
    await mutate(hod, "approve", { decision: "APPROVED" });
    await mutate(cmo, "approve", { decision: "APPROVED" });
    await assert.rejects(
      mutate(scm, "approve", {
        decision: "APPROVED",
        acknowledge_vendor_ownership: true,
        agreement_file_id: 999999,
      }),
      { statusCode: 400 },
    );
    const files = {};
    for (const purpose of ["AGREEMENT", "RECEIPT", "RETURN", "WAIVER"]) {
      c = await service.attach(requester, c.id, {
        file_name: purpose + ".pdf",
        storage_name: require("node:crypto").randomUUID() + ".pdf",
        purpose,
      });
      files[purpose] = c.files.find((f) => f.purpose === purpose).id;
    }
    await assert.rejects(service.download(finance, c.id, files.AGREEMENT), {
      statusCode: 403,
    });
    await mutate(scm, "approve", {
      decision: "APPROVED",
      acknowledge_vendor_ownership: true,
      agreement_file_id: files.AGREEMENT,
    });
    assert.equal(c.authorization_code, `SCN-${inst}-${c.id}`);
    const line = (name, qty, expiry = "2099-12-31") => ({
      requested_item_index: 0,
      item_name: name,
      catalogue_code: name + "-SIZE",
      batch_number: name + "-LOT",
      expiry_date: expiry,
      delivered_quantity: qty,
      unit_price: "10.0000",
      sterile_intact: true,
      inspection_notes: "Inspected and counted",
    });
    const receipt = {
      received_date: m.today(),
      location: "Operating theatre receiving",
      delivery_reference: "DELIVERY-FIXTURE-1",
      vendor_representative: "Fixture rep",
      vendor_contact: "Fixture contact",
      vendor_ownership_acknowledged: true,
      terms_acknowledged: true,
      evidence_file_id: files.RECEIPT,
      lines: [
        line("Screw", 10),
        line("Plate", 5),
        line("Expired plate", 2, "2000-01-01"),
      ],
    };
    await assert.rejects(mutate(surgeon, "receipt", receipt), {
      statusCode: 403,
    });
    await mutate(receiver, "receipt", receipt);
    const r = c.receipts[0];
    assert(c.lines.some((l) => !l.accepted));
    await assert.rejects(
      mutate(nurse, "save_usage", {
        procedure_event_date: m.today(),
        lines: [],
      }),
      { statusCode: 403 },
    );
    await mutate(scm, "confirm_receipt", { receipt_id: r.id });
    const usage = c.lines.map((l, i) => ({
      receipt_line_id: l.id,
      used_quantity: i === 0 ? 3 : 0,
      damaged_quantity: i === 1 ? 1 : 0,
      missing_quantity: i === 1 ? 1 : 0,
      notes:
        i === 1
          ? "One opened unused and one unaccounted"
          : "Quantities documented",
    }));
    await assert.rejects(
      mutate(nurse, "save_usage", {
        procedure_event_date: m.today(),
        procedure_outcome: "CANCELLED",
        lines: usage,
      }),
      { statusCode: 400 },
    );
    const invalid = usage.map((u, i) =>
      i === 2 ? { ...u, used_quantity: 1 } : u,
    );
    await assert.rejects(
      mutate(nurse, "save_usage", {
        procedure_event_date: m.today(),
        lines: invalid,
      }),
      { statusCode: 409 },
    );
    await mutate(nurse, "save_usage", {
      procedure_event_date: m.today(),
      lines: usage,
    });
    const attest = {
      confirm_quantities: true,
      vendor_informed: true,
      acknowledge_used_billing: true,
    };
    await assert.rejects(mutate(nurse, "attest", attest), { statusCode: 409 });
    const ret = (l, kind, quantity) => ({
      receipt_line_id: l.id,
      kind,
      quantity,
      returned_date: m.today(),
      vendor_representative: "Fixture company receiver",
      evidence_file_id: files.RETURN,
    });
    await assert.rejects(
      mutate(receiver, "return", ret(c.lines[0], "INTACT", 8)),
      { statusCode: 409 },
    );
    await mutate(receiver, "return", ret(c.lines[0], "INTACT", 7));
    await mutate(receiver, "return", ret(c.lines[1], "INTACT", 3));
    await mutate(receiver, "return", ret(c.lines[1], "DAMAGED", 1));
    await mutate(receiver, "return", ret(c.lines[2], "INTACT", 2));
    await assert.rejects(mutate(nurse, "attest", attest), { statusCode: 409 });
    await mutate(scm, "waiver", {
      receipt_line_id: c.lines[1].id,
      evidence_file_id: files.WAIVER,
      vendor_no_charge: true,
      notes: "Vendor written no-charge settlement for opened / missing units",
    });
    await mutate(nurse, "attest", { ...attest, signature: { name: "Forged" } });
    assert.equal(c.status, "USAGE_REVIEW");
    assert.equal(c.attestations[0].signature.user_id, nurse.id);
    await assert.rejects(
      mutate(nurse, "save_usage", {
        procedure_event_date: m.today(),
        lines: usage,
      }),
      { statusCode: 403 },
    );
    await mutate(surgeon, "attest", attest);
    await mutate(receiver, "attest", attest);
    assert.equal(c.status, "USAGE_CONFIRMED");
    await mutate(scm, "release_billing");
    assert.equal(c.status, "RECONCILED");
    assert.equal(c.usage_snapshot.total, "30.00");
    assert.deepEqual(
      c.usage_snapshot.lines.map((l) => l.billable_quantity),
      [3, 0, 0],
    );
    const pr = (
      await client.query(
        "INSERT INTO public.requests(request_type,status,requester_id,department_id,institute_id) VALUES('Non-Stock','Approved',$1,$2,$3) RETURNING id",
        [requester.id, department, inst],
      )
    ).rows[0].id;
    const billing = c.usage_snapshot.lines[0];
    const ri = (
      await client.query(
        "INSERT INTO public.requested_items(request_id,item_name,quantity,request_mode,catalog_status,restriction_justification,unit_of_measure) VALUES($1,$2,3,'approved_free_text_exception','approved_exception','Authorized usage-only demand','Piece') RETURNING id",
        [pr, billing.billing_description],
      )
    ).rows[0].id;
    const po = (
      await client.query(
        "INSERT INTO public.purchase_orders(request_id,po_number,supplier_id,currency,status,created_by) VALUES($1,'SURGICAL-PO-FIXTURE',$2,'IQD','PO_ISSUED',$3) RETURNING *",
        [pr, supplier, scm.id],
      )
    ).rows[0];
    const pol = (
      await client.query(
        "INSERT INTO public.purchase_order_items(purchase_order_id,requested_item_id,request_item_id,request_id,item_name,quantity,unit_price,line_type,source_uom,base_uom,conversion_factor) VALUES($1,$2,$2,$3,$4,3,10,'NON_INVENTORY','Piece','Piece',1) RETURNING *",
        [po.id, ri, pr, billing.billing_description],
      )
    ).rows[0];
    await mutate(scm, "bind_po", {
      purchase_order_id: po.id,
      mappings: [
        {
          receipt_line_id: billing.receipt_line_id,
          purchase_order_item_id: pol.id,
        },
      ],
    });
    assert.equal(c.status, "BILLING_LINKED");
    const ownedBefore = (
      await client.query(
        "SELECT count(*)::int AS n FROM public.inventory_transactions",
      )
    ).rows[0].n;
    const grBase = {
      repository: repo,
      purchaseOrderId: po.id,
      actor: scm,
      idempotencyKey: "surgical-gr",
      lines: [
        {
          purchase_order_item_id: pol.id,
          received_quantity: 3,
          batch_number: billing.batch_number,
        },
      ],
    };
    await assert.rejects(
      createGoodsReceipt({
        ...grBase,
        idempotencyKey: "surgical-gr-bad",
        lines: [{ ...grBase.lines[0], batch_number: "WRONG" }],
      }),
      { code: "SURGICAL_CONSIGNMENT_RECEIPT_MISMATCH" },
    );
    const gr = await createGoodsReceipt(grBase);
    assert.equal(gr.inventoryMovements.length, 0);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM public.inventory_transactions",
        )
      ).rows[0].n,
      ownedBefore,
    );
    const inv = (qty, key, rate = "10") =>
      submitSupplierInvoice({
        repository: repo,
        purchaseOrderId: po.id,
        supplierId: supplier,
        invoiceNumber: key,
        invoiceDate: m.today(),
        currency: "IQD",
        lines: [
          { purchase_order_item_id: pol.id, quantity: qty, unit_price: rate },
        ],
        idempotencyKey: key,
        actor: scm,
      });
    await assert.rejects(inv(10, "surgical-overbill"), {
      code: "SURGICAL_CONSIGNMENT_OVERBILLING",
    });
    await assert.rejects(inv(1, "surgical-rate", "11"), {
      code: "SURGICAL_CONSIGNMENT_INVOICE_MISMATCH",
    });
    const first = await inv(2, "surgical-invoice-1");
    await assert.rejects(inv(2, "surgical-invoice-2-too-many"), {
      code: "SURGICAL_CONSIGNMENT_OVERBILLING",
    });
    assert((await inv(2, "surgical-invoice-1")).idempotent);
    assert(
      (
        await runInvoiceMatch({
          repository: repo,
          invoiceId: first.invoice.id,
          actor: scm,
        })
      ).matched,
    );
    const last = await inv(1, "surgical-invoice-last");
    assert(
      (
        await runInvoiceMatch({
          repository: repo,
          invoiceId: last.invoice.id,
          actor: scm,
        })
      ).matched,
    );
    await mutate(scm, "close");
    assert.equal(c.status, "CLOSED");
    assert.equal(
      (await service.get(finance, c.id)).balance[0].billable_quantity,
      3,
    );
    await assert.rejects(mutate(scm, "cancel"), { statusCode: 409 });
    failNotification = true;
    const before = (
      await client.query(
        "SELECT count(*)::int AS n FROM public.surgical_consignment_cases",
      )
    ).rows[0].n;
    await assert.rejects(
      service.create(requester, {
        ...seed,
        submission_key: "surgical-rollback",
      }),
      /Surgical notification failure/,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM public.surgical_consignment_cases",
        )
      ).rows[0].n,
      before,
    );
    // A cancelled operation after delivery must return/reconcile stock, not erase custody.
    c = await service.create(requester, {
      ...seed,
      submission_key: "cancelled-procedure-fixture",
    });
    const extraFiles = {};
    for (const purpose of ["AGREEMENT", "RECEIPT", "RETURN"]) {
      c = await service.attach(requester, c.id, {
        file_name: purpose + ".pdf",
        storage_name: require("node:crypto").randomUUID() + ".pdf",
        purpose,
      });
      extraFiles[purpose] = c.files.find((f) => f.purpose === purpose).id;
    }
    await mutate(hod, "approve", { decision: "APPROVED" });
    await mutate(cmo, "approve", { decision: "APPROVED" });
    await mutate(scm, "approve", {
      decision: "APPROVED",
      acknowledge_vendor_ownership: true,
      agreement_file_id: extraFiles.AGREEMENT,
    });
    await mutate(receiver, "receipt", {
      ...receipt,
      evidence_file_id: extraFiles.RECEIPT,
      delivery_reference: "CANCELLED-DELIVERY",
      lines: [line("Unused screw", 2)],
    });
    await mutate(scm, "confirm_receipt", { receipt_id: c.receipts[0].id });
    await mutate(nurse, "save_usage", {
      procedure_event_date: m.today(),
      procedure_outcome: "CANCELLED",
      lines: [
        {
          receipt_line_id: c.lines[0].id,
          used_quantity: 0,
          damaged_quantity: 0,
          missing_quantity: 0,
          notes: "Procedure cancelled before use",
        },
      ],
    });
    await mutate(receiver, "return", {
      ...ret(c.lines[0], "INTACT", 2),
      evidence_file_id: extraFiles.RETURN,
    });
    await mutate(nurse, "attest", attest);
    await mutate(surgeon, "attest", attest);
    await mutate(receiver, "attest", attest);
    await mutate(scm, "release_billing");
    await mutate(scm, "close");
    assert.equal(c.status, "CLOSED");
    assert.equal(c.usage_snapshot.procedure_outcome, "CANCELLED");
    assert.equal(c.usage_snapshot.total, "0.00");
    assert.equal(c.billing_po_id, null);
    // Widening legacy one-character fingerprint metadata preserves every stored byte.
    await client.query("SAVEPOINT narrow_fingerprint_fixture");
    for (const table of ["goods_receipts", "supplier_invoices"])
      await client.query(
        `ALTER TABLE public.${table} ALTER COLUMN payload_fingerprint TYPE character(1) USING left(payload_fingerprint,1)`,
      );
    const oldFingerprints = (
      await client.query(
        "SELECT 'receipt' AS kind,id,payload_fingerprint::text AS hash FROM public.goods_receipts UNION ALL SELECT 'invoice',id,payload_fingerprint::text FROM public.supplier_invoices ORDER BY 1,2",
      )
    ).rows;
    await client.query(ddl.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
    assert.deepEqual(
      (
        await client.query(
          "SELECT 'receipt' AS kind,id,payload_fingerprint::text AS hash FROM public.goods_receipts UNION ALL SELECT 'invoice',id,payload_fingerprint::text FROM public.supplier_invoices ORDER BY 1,2",
        )
      ).rows,
      oldFingerprints,
    );
    await client.query("ROLLBACK TO SAVEPOINT narrow_fingerprint_fixture");
    const history = JSON.stringify(
      (
        await client.query(
          "SELECT * FROM public.surgical_consignment_attestations ORDER BY case_id,role",
        )
      ).rows,
    );
    await client.query(ddl.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, ""));
    assert.equal(
      JSON.stringify(
        (
          await client.query(
            "SELECT * FROM public.surgical_consignment_attestations ORDER BY case_id,role",
          )
        ).rows,
      ),
      history,
    );
    console.log(
      "SQL 051 surgical consignment: ordered authorization, private clinical scope, temporary custody/quarantine, used/returned/damaged/missing reconciliation, independent F20 signatures, usage-only PO and invoice caps, no inventory posting, canonical invoice matching, retry/rollback and populated repeat preservation PASS",
    );
  } finally {
    await client.query("ROLLBACK");
  }
};
