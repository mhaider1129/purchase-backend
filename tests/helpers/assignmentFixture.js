const clone = (value) => structuredClone(value);
module.exports = function fixture(pool, lookup) {
  let state = {
    users: [
      {
        id: 7,
        role: "Assignment manager",
        institute_id: 1,
        department_id: 3,
        is_active: true,
        permissions: ["requests.manage"],
        name: "Manager",
      },
      ...[10, 11].map((id) => ({
        id,
        role: "ProcurementSpecialist",
        institute_id: 1,
        department_id: 3,
        is_active: true,
        permissions: ["procurement.update-status"],
        name: `Buyer ${id}`,
        email: `buyer${id}@example.test`,
      })),
      {
        id: 12,
        role: "ProcurementSpecialist",
        institute_id: 2,
        department_id: 4,
        is_active: true,
        permissions: ["procurement.update-status"],
        name: "Foreign buyer",
      },
      {
        id: 13,
        role: "ProcurementSpecialist",
        institute_id: 1,
        is_active: false,
        permissions: ["procurement.update-status"],
      },
      {
        id: 14,
        role: "Requester",
        institute_id: 1,
        is_active: true,
        permissions: ["procurement.update-status"],
      },
      {
        id: 15,
        role: "SCM",
        institute_id: 1,
        is_active: true,
        permissions: [],
      },
      {
        id: 20,
        role: "Approver",
        institute_id: 1,
        is_active: true,
        permissions: [],
        name: "Approver",
      },
    ],
    requests: [
      {
        id: 55,
        status: "Approved",
        request_type: "Non-Stock",
        institute_id: 1,
        department_id: 3,
        assigned_to: null,
        requester_id: 90,
      },
      {
        id: 56,
        status: "Approved",
        request_type: "Non-Stock",
        institute_id: 2,
        department_id: 4,
        assigned_to: null,
      },
    ],
    departments: [
      { id: 3, institute_id: 1 },
      { id: 4, institute_id: 2 },
    ],
    warehouses: [
      {
        id: 8,
        department_id: 3,
        institute_id: 1,
        is_active: true,
        name: "Local warehouse",
      },
      { id: 9, department_id: 4, institute_id: 2, is_active: true },
    ],
    items: [100, 101, 102].map((id) => ({
      id,
      request_id: 55,
      item_name: `Item ${id}`,
      approval_status: "Approved",
      assigned_to: null,
      assignment_notes: null,
    })),
    rules: [
      {
        id: 1,
        institute_id: 1,
        request_type: "Non-stock",
        warehouse_id: null,
        assignee_user_id: 10,
        is_active: true,
      },
      {
        id: 2,
        institute_id: 2,
        request_type: "Non-stock",
        warehouse_id: null,
        assignee_user_id: 12,
        is_active: true,
      },
      {
        id: 3,
        institute_id: null,
        request_type: "Non-stock",
        warehouse_id: null,
        assignee_user_id: 12,
        is_active: true,
      },
    ],
    approvals: [
      {
        id: 4,
        request_id: 55,
        approver_id: 20,
        status: "Approved",
        is_superseded: false,
      },
    ],
    cases: [
      {
        id: 200,
        request_id: 55,
        requested_item_id: 100,
        institute_id: 1,
        department_id: 3,
        assigned_buyer_id: null,
        closed_at: null,
        workload_units: 4,
        complexity_score: 40,
      },
    ],
    logs: [],
    audits: [],
    outbox: [],
    notifications: [],
    sequence: 500,
    schema: true,
    columns: true,
    casesAvailable: true,
    failAudit: false,
    failOutbox: false,
  };
  const statements = [];
  let queue = Promise.resolve(),
    hook;
  const result = (rows) => ({ rows: clone(rows), rowCount: rows.length });
  lookup.mockImplementation(async (userId) => {
    const user = state.users.find((u) => u.id === Number(userId));
    return {
      found: !!user,
      permissions: user?.permissions || [],
      dataScopes: user?.scopes || {},
    };
  });
  const query = async (raw, p = []) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    statements.push({ sql, p: clone(p) });
    if (hook) await hook(sql, p, state);
    if (sql.startsWith("SELECT id,name,email,role,institute_id"))
      return result(state.users.filter((u) => u.id === Number(p[0])));
    if (sql.startsWith("SELECT id,role,department_id"))
      return result(state.users.filter((u) => u.id === Number(p[0])));
    if (
      sql.startsWith("SELECT r.*,") &&
      sql.includes("AS assignment_effective_status")
    )
      return result(state.requests.filter((r) => r.id === Number(p[0])));
    if (sql.startsWith("SELECT r.*, p.name AS project_name"))
      return result(state.requests.filter(r=>r.id===Number(p[0]) && p[1].includes(r.institute_id) && (!sql.includes("r.requester_id = $3") || r.requester_id===p[2] || r.assigned_to===p[2] || state.approvals.some(a=>a.request_id===r.id && a.approver_id===p[2]) || state.items.some(i=>i.request_id===r.id && i.assigned_to===p[2]))));
    if (sql.startsWith("SELECT * FROM requests WHERE id="))
      return result(state.requests.filter((r) => r.id === Number(p[0])));
    if (sql.startsWith("SELECT id,institute_id FROM departments"))
      return result(state.departments.filter((d) => d.id === Number(p[0])));
    if (sql.startsWith("SELECT w.*,d.institute_id"))
      return result(
        state.warehouses
          .filter((w) => w.id === Number(p[0]))
          .map((w) => ({
            ...w,
            department_institute_id: state.departments.find(
              (d) => d.id === w.department_id,
            )?.institute_id,
          })),
      );
    if (sql.startsWith("SELECT id FROM approvals"))
      return result(
        state.approvals.filter(
          (a) =>
            a.request_id === Number(p[0]) &&
            !a.is_superseded &&
            (sql.includes("approver_id=$2")
              ? a.approver_id === Number(p[1]) && a.status === "Approved"
              : !["Approved", "Skipped", "Superseded"].includes(a.status)),
        ),
      );
    if (sql.includes("AS assignment_scope_available"))
      return result([{ assignment_scope_available: state.schema }]);
    if (sql.includes("AS assignment_columns_available"))
      return result([{ assignment_columns_available: state.columns }]);
    if (sql.includes("to_regclass('public.procurement_cases')"))
      return result([{ available: state.casesAvailable }]);
    if (sql.startsWith("SELECT to_regclass("))
      return result([{ available: false }]);
    if (sql.includes("pg_advisory_xact_lock")) return result([]);
    if (
      sql.startsWith(
        "SELECT r.*,u.name AS assignee_name,u.email AS assignee_email",
      ) &&
      sql.includes("LIMIT 2")
    )
      return result(
        state.rules
          .filter(
            (r) =>
              r.institute_id === Number(p[0]) &&
              r.request_type.toLowerCase() === p[1].toLowerCase() &&
              (r.warehouse_id || null) === (p[2] || null) &&
              r.is_active &&
              state.users.some(
                (u) =>
                  u.id === r.assignee_user_id &&
                  u.institute_id === r.institute_id &&
                  u.is_active,
              ),
          )
          .map((r) => ({
            ...r,
            assignee_name: state.users.find((u) => u.id === r.assignee_user_id)
              .name,
          }))
          .slice(0, 2),
      );
    if (sql.startsWith("SELECT r.*,u.name AS assignee_name"))
      return result(
        state.rules.filter(
          (r) =>
            r.institute_id === Number(p[0]) &&
            state.users.some(
              (u) =>
                u.id === r.assignee_user_id &&
                u.institute_id === r.institute_id,
            ) &&
            (r.warehouse_id == null ||
              state.warehouses.some(
                (w) =>
                  w.id === r.warehouse_id && w.institute_id === r.institute_id,
              )),
        ),
      );
    if (sql.startsWith("SELECT id FROM users WHERE institute_id="))
      return result(
        state.users
          .filter((u) => u.institute_id === Number(p[0]) && u.is_active)
          .map((u) => ({ id: u.id })),
      );
    if (sql.startsWith("SELECT w.id,w.name FROM warehouses"))
      return result(
        state.warehouses.filter(
          (w) => w.institute_id === Number(p[0]) && w.is_active,
        ),
      );
    if (sql.startsWith("SELECT * FROM requested_items WHERE request_id="))
      return result(state.items.filter((i) => i.request_id === Number(p[0])));
    if (sql.startsWith("SELECT id FROM requested_items WHERE request_id="))
      return result(
        state.items.filter(
          (i) =>
            i.request_id === Number(p[0]) && i.assigned_to === Number(p[1]),
        ),
      );
    if (sql.startsWith("SELECT c.*,i.request_id AS item_request_id"))
      return result(
        state.cases
          .filter((c) => c.request_id === Number(p[0]) && !c.closed_at)
          .map((c) => ({
            ...c,
            item_request_id: state.items.find(
              (i) => i.id === c.requested_item_id,
            )?.request_id,
          })),
      );
    if (sql.startsWith("UPDATE procurement_cases SET assigned_buyer_id=")) {
      const row = state.cases.find((c) => c.id === p[0]);
      row.assigned_buyer_id = p[1];
      row.updated_by = p[2];
      return result([row]);
    }
    if (sql.startsWith("UPDATE requested_items SET assigned_to=")) {
      const row = state.items.find(
        (i) => i.id === p[3] && i.request_id === p[4],
      );
      Object.assign(row, {
        assigned_to: p[0],
        assigned_by: p[1],
        assignment_notes: p[2],
      });
      return result([row]);
    }
    if (sql.startsWith("UPDATE requests SET assigned_to=")) {
      const row = state.requests.find((r) => r.id === Number(p[1]));
      row.assigned_to = p[0];
      return result([row]);
    }
    if (sql.startsWith("INSERT INTO request_logs")) {
      const row = {
        id: state.sequence++,
        request_id: p[0],
        action: p[1],
        actor_id: p[2],
        comments: p[3],
      };
      state.logs.push(row);
      return result([row]);
    }
    if (sql.startsWith("SELECT rl.*"))
      return result(state.logs.filter((l) => l.request_id === Number(p[0])));
    if (sql.startsWith("INSERT INTO audit_logs")) {
      if (state.failAudit) throw Error("Audit failure");
      const row = {
        id: state.sequence++,
        action: p[0],
        actor_id: p[1],
        entity_type: p[2],
        entity_id: p[3],
        ...JSON.parse(p[5]),
      };
      state.audits.push(row);
      return result([row]);
    }
    if (sql.startsWith("INSERT INTO notification_outbox")) {
      if (state.failOutbox) throw Error("Outbox failure");
      if (state.outbox.some((e) => e.idempotency_key === p[5]))
        return result([]);
      const row = {
        id: state.sequence++,
        event_type: p[0],
        entity_type: p[1],
        entity_id: p[2],
        recipient_user_id: p[3],
        payload: JSON.parse(p[4]),
        idempotency_key: p[5],
      };
      state.outbox.push(row);
      return result([row]);
    }
    if (
      sql.startsWith("SELECT * FROM notification_outbox WHERE idempotency_key=")
    )
      return result(state.outbox.filter((e) => e.idempotency_key === p[0]));
    if (sql.startsWith("INSERT INTO notifications")) {
      if (state.notifications.some((n) => n.outbox_event_id === p[5]))
        return result([]);
      const row = {
        id: state.sequence++,
        user_id: p[0],
        outbox_event_id: p[5],
      };
      state.notifications.push(row);
      return result([row]);
    }
    if (sql.startsWith("SELECT * FROM request_auto_assignment_rules WHERE id="))
      return result(
        state.rules.filter(
          (r) => r.id === Number(p[0]) && r.institute_id === Number(p[1]),
        ),
      );
    if (
      sql.startsWith(
        "SELECT * FROM request_auto_assignment_rules WHERE institute_id=",
      )
    )
      return result(
        state.rules.filter(
          (r) =>
            r.institute_id === Number(p[0]) &&
            r.request_type.toLowerCase() === p[1].toLowerCase() &&
            (r.warehouse_id || null) === (p[2] || null),
        ),
      );
    if (sql.startsWith("INSERT INTO request_auto_assignment_rules")) {
      const row = {
        id: state.sequence++,
        institute_id: p[0],
        request_type: p[1],
        warehouse_id: p[2],
        assignee_user_id: p[3],
        is_active: p[4],
        created_by: p[5],
      };
      state.rules.push(row);
      return result([row]);
    }
    if (sql.startsWith("UPDATE request_auto_assignment_rules SET")) {
      const row = state.rules.find(
        (r) => r.id === p[5] && r.institute_id === p[6],
      );
      if (!row) return result([]);
      Object.assign(row, {
        request_type: p[0],
        warehouse_id: p[1],
        assignee_user_id: p[2],
        is_active: p[3],
        updated_by: p[4],
      });
      return result([row]);
    }
    if (sql.startsWith("DELETE FROM request_auto_assignment_rules")) {
      state.rules = state.rules.filter(
        (r) => !(r.id === Number(p[0]) && r.institute_id === Number(p[1])),
      );
      return result([]);
    }
    throw Error(`Unhandled assignment fixture SQL: ${sql}`);
  };
  pool.query.mockImplementation(query);
  pool.connect.mockImplementation(async () => {
    let before, unlock;
    return {
      release: jest.fn(),
      query: async (sql, p) => {
        if (sql === "BEGIN") return result([]);
        if (sql === "COMMIT") { unlock?.(); return result([]); }
        if (sql === "ROLLBACK") { if(before)state=before; unlock?.(); return result([]); }
        // Model the locks explicitly requested by the implementation rather
        // than serializing every BEGIN. Real PostgreSQL interleavings remain
        // a separate integration check; removing the parent lock now exposes
        // stale reads in the duplicate/concurrent assignment regressions.
        if (!unlock && (/FROM requests r .*FOR UPDATE OF r/.test(sql) || /FROM requests WHERE id=\$1 FOR SHARE/.test(sql) || sql.includes('pg_advisory_xact_lock') || sql.includes('FOR UPDATE OF c'))) {
          const prior=queue;queue=new Promise(resolve=>{unlock=resolve;});await prior;before=clone(state);
        }
        return query(sql, p);
      },
    };
  });
  return {
    get state() {
      return state;
    },
    statements,
    set hook(value) {
      hook = value;
    },
    async automatic(work) {
      const client = await pool.connect();
      await client.query("BEGIN");
      try {
        const out = await work(client);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
};
