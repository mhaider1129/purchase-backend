const {
  createSurgicalConsignmentRoutingService,
} = require("../services/surgicalConsignmentRoutingService");
const actor = {
  id: 1,
  institute_id: 7,
  department_id: 30,
  role: "Requester",
  permissions: ["stock-requests.create"],
};
const people = [
  { id: 1, name: "Submitting doctor", role: "Requester", department_id: 30 },
  { id: 2, name: "Nurse", role: "Requester" },
  { id: 3, name: "Receiver", role: "WarehouseKeeper", warehouse_id: 8 },
  { id: 4, name: "HOD", role: "HOD", department_id: 9 },
  { id: 5, name: "CMO", role: "CMO" },
  { id: 6, name: "SCM", role: "SCM" },
  { id: 7, name: "Section nurse", role: "Requester" },
];
function fixture({ users = people, setting = {}, available = true } = {}) {
  const db = {
    query: jest.fn(async (sql) => {
      if (sql.includes("AS available")) return { rows: [{ available }] };
      if (sql.includes("SELECT s.*,d.name"))
        return {
          rows: [
            {
              department_id: 9,
              department_name: "Operating theatres",
              nurse_id: 2,
              warehouse_id: 8,
              warehouse_name: "Surgical warehouse",
              warehouse_active: true,
              warehouse_institute_id: 7,
              row_version: 2,
              ...setting,
            },
          ],
        };
      if (sql.includes("FROM public.sections"))
        return { rows: [{ id: 12, name: "Operating room" }] };
      if (sql.includes("SELECT nurse_id")) return { rows: [{ nurse_id: 7 }] };
      if (sql.includes("SELECT u.id,u.name")) return { rows: users };
      return { rows: [] };
    }),
  };
  return { db, service: createSurgicalConsignmentRoutingService(db) };
}
test("submitting doctor is the surgeon regardless of their HR department; the managed section controls the nurse", async () => {
  const { service } = fixture();
  const result = await service.resolve(actor, 9, 12);
  expect(result.surgeon).toEqual({ id: 1, name: "Submitting doctor" });
  expect(result.nurse.id).toBe(7);
  expect(result.nurse_source).toBe("SECTION");
  expect(result.receiver.id).toBe(3);
  expect(result.manager.id).toBe(4);
  expect(result.cmo.id).toBe(5);
  expect(result.scm.id).toBe(6);
});
test("department nursing responsibility is used without a section override", async () => {
  const { service } = fixture();
  expect((await service.resolve(actor, 9)).nurse.id).toBe(2);
});
test.each(["CMO", "SCM", "HOD"])(
  "ambiguous %s responsibility cannot pick an arbitrary person",
  async (role) => {
    const extra = { ...people.find((u) => u.role === role), id: 99 };
    const { service } = fixture({ users: [...people, extra] });
    await expect(service.resolve(actor, 9)).rejects.toMatchObject({
      code: "SURGICAL_ROUTING_NOT_READY",
      statusCode: 409,
    });
  },
);
test("an explicit current organizational department head takes precedence over generic HOD accounts", async () => {
  const { service } = fixture({
    users: [
      ...people,
      {
        id: 10,
        name: "Current organizational head",
        role: "Doctor",
        structural_head: true,
        department_id: 30,
      },
    ],
  });
  expect((await service.resolve(actor, 9)).manager.id).toBe(10);
});
test("warehouse responsibility must be unique or explicitly configured in Management", async () => {
  const users = [
    ...people,
    {
      id: 20,
      name: "Second receiver",
      role: "WarehouseKeeper",
      warehouse_id: 8,
    },
  ];
  await expect(
    fixture({ users }).service.resolve(actor, 9),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (
      await fixture({ users, setting: { receiver_id: 20 } }).service.resolve(
        actor,
        9,
      )
    ).receiver.id,
  ).toBe(20);
});
test("an inactive or foreign warehouse never becomes a receiving assignment", async () => {
  for (const setting of [
    { warehouse_active: false },
    { warehouse_institute_id: 99 },
  ])
    await expect(
      fixture({ setting }).service.resolve(actor, 9),
    ).rejects.toMatchObject({ statusCode: 409 });
});
test("the submitting surgeon cannot authorize their own request", async () => {
  const users = people
    .filter((u) => u.id !== 4)
    .map((u) => (u.id === 1 ? { ...u, role: "HOD", department_id: 9 } : u));
  await expect(
    fixture({ users }).service.resolve(actor, 9),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: expect.stringContaining("cannot authorize"),
  });
});
test("missing setup requests full SQL 053 without running DDL or inventing assignments", async () => {
  const { service, db } = fixture({ available: false });
  await expect(service.resolve(actor, 9)).rejects.toMatchObject({
    statusCode: 503,
    code: "SURGICAL_ROUTING_SCHEMA_REQUIRED",
  });
  expect(db.query).toHaveBeenCalledTimes(1);
});
test("unprivileged users cannot enumerate or change Management configuration", async () => {
  const { service, db } = fixture();
  await expect(service.management(actor)).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(service.save(actor, {})).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(db.query).not.toHaveBeenCalled();
});
