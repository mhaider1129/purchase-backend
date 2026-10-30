const fixture = require("./helpers/attachmentFixture");
const {
  createAttachmentAuthorization,
} = require("../services/attachmentAuthorizationService");
let f, access;
beforeEach(() => {
  f = fixture();
  access = createAttachmentAuthorization(f.db, f.authority);
});
const read = async () =>
  access.attachment(
    await access.actor({ id: 1, institute_id: 999, permissions: ["forged"] }),
    30,
  );
test("anonymous and inactive accounts cannot inspect file metadata", async () => {
  await expect(access.actor(null)).rejects.toMatchObject({ statusCode: 401 });
  f.state.user.is_active = false;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("authorized requester inherits the parent read/upload capability", async () => {
  await expect(read()).resolves.toMatchObject({ id: 30 });
  await expect(
    access.parent(await access.actor({ id: 1 }), { requestId: 20 }, "upload"),
  ).resolves.toMatchObject({ id: 20 });
});
test("unrelated same-institute user denied even with generic procurement permission", async () => {
  f.state.root.requester_id = 2;
  f.state.permissions = ["procurement.update-status"];
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("foreign institute denied regardless of request ownership or view-all permission", async () => {
  f.state.root.institute_id = 11;
  f.state.permissions = ["requests.view-all"];
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("cross-institute access requires both explicit override and bounded target scope", async () => {
  f.state.root.institute_id = 11;
  f.state.permissions = ["requests.view-all", "requests.cross-institute"];
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
  f.state.scopes = { institute_ids: [11] };
  await expect(read()).resolves.toMatchObject({ id: 30 });
});
test("current authorized approver has delegated parent access, revoked assignment does not", async () => {
  f.state.root.requester_id = 2;
  f.state.approver = true;
  await expect(read()).resolves.toMatchObject({ id: 30 });
  f.state.approver = false;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("assigned buyer needs current procurement permission and item assignment", async () => {
  f.state.root.requester_id = 2;
  f.state.buyer = true;
  f.state.permissions = ["procurement.update-status"];
  await expect(read()).resolves.toMatchObject({ id: 30 });
  f.state.permissions = [];
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("technical reviewer sees selected evidence only and loses access after reassignment", async () => {
  f.state.root.requester_id = 2;
  f.state.file.uploaded_by = 2;
  f.state.tables.add("preprocurement_technical_review_assignments");
  f.state.technical = true;
  await expect(read()).resolves.toMatchObject({ id: 30 });
  f.state.selected = false;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
  f.state.selected = true;
  f.state.technical = false;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("orphan files fail closed and uploader identity alone does not grant parent access", async () => {
  f.state.root.requester_id = 2;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
  f.state.file.request_id = null;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("legacy contract provenance must be known and consistent", async () => {
  f.state.contract = {
    id: 9,
    creator_institute_id: 10,
    department_institute_id: 10,
    created_by: 1,
  };
  f.state.file = { ...f.state.file, request_id: null, contract_id: 9 };
  await expect(read()).resolves.toMatchObject({ id: 30 });
  f.state.contract.department_institute_id = 11;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("mixed-parent files must authorize every parent", async () => {
  f.state.file.contract_id = 9;
  f.state.contract = { id: 9, creator_institute_id: 11, created_by: 1 };
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
test("view permission is insufficient for delete", async () => {
  f.state.root.requester_id = 2;
  f.state.file.uploaded_by = 1;
  f.state.permissions = ["requests.view-all"];
  const a = await access.actor({ id: 1 });
  await expect(access.attachment(a, 30, "delete")).rejects.toMatchObject({
    statusCode: 404,
  });
});

test("plan file requires both a current planning capability and department ownership", async () => {
  f.state.plan = { id: 5, institute_id: 10, department_id: 2 };
  const a = await access.actor({ id: 1 });
  await expect(access.plan(a, 5)).resolves.toMatchObject({ id: 5 });
  f.state.plan.department_id = 3;
  await expect(access.plan(a, 5)).rejects.toMatchObject({ statusCode: 404 });
  f.state.permissions = ["requests.manage"];
  const manager = await access.actor({ id: 1 });
  await expect(access.plan(manager, 5)).resolves.toMatchObject({ id: 5 });
  f.state.plan.institute_id = 11;
  await expect(access.plan(manager, 5)).rejects.toMatchObject({
    statusCode: 404,
  });
});

test("receiving capability grants only selected delivery evidence within institute", async () => {
  f.state.root.requester_id = 2;
  f.state.file.uploaded_by = 2;
  f.state.permissions = ["procure-to-pay.receipts.manage"];
  f.state.receiver = true;
  f.state.tables.add("delivery_inspection_tasks");
  f.state.tables.add("technical_evidence_references");
  await expect(read()).resolves.toMatchObject({ id: 30 });
  f.state.selected = false;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
  f.state.selected = true;
  f.state.permissions = [];
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});

test("contract role/department approvers reuse the existing approval policy", async () => {
  f.state.user.role = "CFO";
  f.state.permissions = [];
  f.state.file.request_id = null;
  f.state.file.contract_id = 9;
  f.state.contract = { id: 9, creator_institute_id: 10, created_by: 2 };
  f.state.tables.add("contract_approvals");
  f.state.contractStep = {
    id: 1,
    reviewer_id: null,
    reviewer_role: "finance",
    reviewer_department_id: 2,
    is_active: true,
  };
  await expect(read()).resolves.toMatchObject({ id: 30 });
  f.state.contractStep.reviewer_department_id = 3;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});

test("explicit contract business ownership supports a bounded cross-institute actor", async () => {
  f.state.permissions = ["contracts.manage", "requests.cross-institute"];
  f.state.scopes = { institute_ids: [11] };
  f.state.file.request_id = null;
  f.state.file.contract_id = 9;
  f.state.contract = {
    id: 9,
    creator_institute_id: 10,
    department_institute_id: 11,
    created_by: 1,
  };
  await expect(read()).resolves.toMatchObject({ id: 30 });
  f.state.contract.request_institute_id = 12;
  await expect(read()).rejects.toMatchObject({ statusCode: 404 });
});
