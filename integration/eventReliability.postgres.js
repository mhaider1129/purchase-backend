"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool, Client } = require("pg");
async function run(owner, url) {
  process.env.DATABASE_URL =
    require("./disposableDatabase").disposableDatabaseUrl(url);
  process.env.NODE_ENV = "test";
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 12,
  });
  const audit = require("../services/auditService").writeAuditEvent;
  const enqueue =
    require("../services/notificationOutboxService").enqueueNotification;
  const {
    createNotificationOutboxProcessor,
    deliverInApp,
  } = require("../services/notificationOutboxProcessor");
  const emails = require("../services/notificationEmailDelivery");
  const authority = require("../services/eventAuthority");
  const diagnostic = require("../services/eventReconciliationService");
  const one = async (q, p = []) => (await owner.query(q, p)).rows[0];
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    console.log("PASS event reliability " + name);
    passed++;
  };
  const fixture = async () => {
    const key = crypto.randomUUID();
    const institute = await one(
      "INSERT INTO institutes(name) VALUES($1) RETURNING id",
      ["Events " + key],
    );
    const user = await one(
      "INSERT INTO users(name,email,password,role,institute_id,is_active) VALUES('Event reviewer',$1,'not-a-login-secret','EVENT_TEST',$2,true) RETURNING *",
      [key + "@disposable.test", institute.id],
    );
    const request = await one(
      "INSERT INTO requests(requester_id,institute_id,status,request_type) VALUES($1,$2,'Submitted','Medical Device') RETURNING *",
      [user.id, institute.id],
    );
    return { institute, user, request, key };
  };
  const tx = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_current_xact_id()");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  };
  const event = (f) => ({
    type: "WORKFLOW_NOTICE",
    entityType: "request",
    entityId: f.request.id,
    userId: f.user.id,
    idempotencyKey: f.key,
    payload: {
      title: "Review request",
      message: "Sign in to review",
      email: true,
    },
  });
  const record = (c, f) =>
    audit({
      client: c,
      entityType: "request",
      entityId: f.request.id,
      action: "REQUEST_CREATED",
      actorUserId: f.user.id,
      instituteId: f.institute.id,
      requestId: f.request.id,
      beforeData: { status: "Submitted" },
      afterData: { status: "Approved" },
      operationKey: f.key,
    });
  const mutate = (f) =>
    tx(async (c) => {
      const prior = await c.query(
        "SELECT * FROM requests WHERE id=$1 FOR UPDATE",
        [f.request.id],
      );
      if (prior.rows[0].status === "Approved") return;
      await c.query("UPDATE requests SET status='Approved' WHERE id=$1", [
        f.request.id,
      ]);
      await record(c, f);
      return enqueue(c, event(f));
    });
  const counts = (f) =>
    one(
      "SELECT (SELECT status FROM requests WHERE id=$1) status,(SELECT count(*)::int FROM audit_logs WHERE target_type='request' AND target_id=$1) audits,(SELECT count(*)::int FROM notification_outbox WHERE idempotency_key=$2) events",
      [f.request.id, f.key],
    );
  const block = async (table, work) => {
    await owner.query(
      `CREATE OR REPLACE FUNCTION event_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_EVENT_FAILURE'; END $$;CREATE TRIGGER event_test_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION event_test_fail()`,
    );
    try {
      await work();
    } finally {
      await owner.query(
        `DROP TRIGGER event_test_fail ON ${table};DROP FUNCTION event_test_fail()`,
      );
    }
  };
  const state = (id) =>
    one("SELECT * FROM notification_outbox WHERE id=$1", [id]);
  const emailState = (id) =>
    one(
      "SELECT * FROM notification_email_deliveries WHERE outbox_event_id=$1",
      [id],
    );
  const notice = async () => {
    const f = await fixture();
    const e = await tx((c) => enqueue(c, event(f)));
    await tx((c) => deliverInApp(c, e.event));
    await owner.query(
      "UPDATE notification_outbox SET status='delivered' WHERE id=$1",
      [e.event.id],
    );
    return { ...f, e: e.event };
  };
  const due = (id) =>
    owner.query(
      "UPDATE notification_email_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE outbox_event_id=$1",
      [id],
    );
  try {
    await test("business change, audit and required event commit together", async () => {
      const f = await fixture();
      await mutate(f);
      assert.deepEqual(await counts(f), {
        status: "Approved",
        audits: 1,
        events: 1,
      });
    });
    await test("audit insertion failure rolls back mutation and outbox", async () => {
      const f = await fixture();
      await block("audit_logs", () =>
        assert.rejects(mutate(f), /INJECTED_EVENT_FAILURE/),
      );
      assert.deepEqual(await counts(f), {
        status: "Submitted",
        audits: 0,
        events: 0,
      });
    });
    await test("outbox failure rolls back business change and audit", async () => {
      const f = await fixture();
      await block("notification_outbox", () =>
        assert.rejects(mutate(f), /INJECTED_EVENT_FAILURE/),
      );
      assert.deepEqual(await counts(f), {
        status: "Submitted",
        audits: 0,
        events: 0,
      });
    });
    await test("explicit rollback leaves no event", async () => {
      const f = await fixture();
      await assert.rejects(
        tx(async (c) => {
          await c.query("UPDATE requests SET status='Approved' WHERE id=$1", [
            f.request.id,
          ]);
          await record(c, f);
          await enqueue(c, event(f));
          throw Error("ROLLBACK_TEST");
        }),
        /ROLLBACK_TEST/,
      );
      assert.equal((await counts(f)).audits, 0);
    });
    await test("critical audit rejects pool/autocommit and missing transaction", async () => {
      const f = await fixture();
      await assert.rejects(record(owner, f), {
        code: "AUDIT_TRANSACTION_REQUIRED",
      });
      await assert.rejects(
        audit({
          entityType: "request",
          entityId: f.request.id,
          action: "REQUEST_CREATED",
        }),
        { code: "AUDIT_TRANSACTION_REQUIRED" },
      );
    });
    await test("lost response retry and duplicate command preserve one mutation", async () => {
      const f = await fixture();
      await mutate(f);
      await mutate(f);
      assert.deepEqual(await counts(f), {
        status: "Approved",
        audits: 1,
        events: 1,
      });
    });
    await test("concurrent duplicate command preserves one mutation", async () => {
      const f = await fixture();
      await Promise.all(Array.from({ length: 5 }, () => mutate(f)));
      assert.deepEqual(await counts(f), {
        status: "Approved",
        audits: 1,
        events: 1,
      });
    });
    await test("audit operation key serializes concurrent retries", async () => {
      const f = await fixture();
      await Promise.all(
        [1, 2].map(() =>
          tx(async (c) => {
            await c.query("SELECT id FROM requests WHERE id=$1 FOR UPDATE", [
              f.request.id,
            ]);
            await record(c, f);
          }),
        ),
      );
      assert.equal((await counts(f)).audits, 1);
    });
    await test("outbox identity cannot be reused with changed content", async () => {
      const f = await fixture();
      await tx((c) => enqueue(c, event(f)));
      await assert.rejects(
        tx((c) => enqueue(c, { ...event(f), payload: { title: "different" } })),
        { code: "OUTBOX_IDEMPOTENCY_CONFLICT" },
      );
    });
    await test("foreign-institute recipient rejected in business transaction", async () => {
      const f = await fixture(),
        foreign = await fixture();
      await assert.rejects(
        tx((c) => enqueue(c, { ...event(f), userId: foreign.user.id })),
        { code: "RECIPIENT_INSTITUTE_CONFLICT" },
      );
      assert.equal((await counts(f)).events, 0);
    });
    await test("supplied institute and supplier identity cannot override source", async () => {
      const f = await fixture();
      await assert.rejects(
        tx((c) => enqueue(c, { ...event(f), instituteId: f.institute.id + 1 })),
        { code: "EVENT_INSTITUTE_CONFLICT" },
      );
      await assert.rejects(
        tx((c) => enqueue(c, { ...event(f), recipientKind: "supplier" })),
        { code: "UNSUPPORTED_RECIPIENT_KIND" },
      );
    });
    // Isolate delivery claims from earlier producer-only tests without altering history.
    await owner.query(
      "UPDATE notification_outbox SET status='delivered' WHERE status='pending'",
    );
    await test("in-app insert and acknowledgment are atomic under worker failure", async () => {
      const f = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      const p = createNotificationOutboxProcessor({
        database: pool,
        deliver: async (c, e) => {
          await deliverInApp(c, e);
          throw Error("after insert");
        },
      });
      assert.equal((await p.processOne()).status, "failed");
      assert.equal(
        Number(
          (
            await one(
              "SELECT count(*) n FROM notifications WHERE outbox_event_id=$1",
              [e.event.id],
            )
          ).n,
        ),
        0,
      );
      assert.equal(await emailState(e.event.id), undefined);
    });
    await owner.query(
      "UPDATE notification_outbox SET status='delivered' WHERE status='failed'",
    );

    await test("database disconnect before in-app commit rolls back and recovers", async () => {
      const f = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      const worker = new Client({ connectionString: process.env.DATABASE_URL });
      worker.on("error", () => {});
      await worker.connect();
      try {
        await worker.query("BEGIN");
        await worker.query(
          "SELECT id FROM notification_outbox WHERE id=$1 FOR UPDATE",
          [e.event.id],
        );
        await worker.query(
          "UPDATE notification_outbox SET status='processing' WHERE id=$1",
          [e.event.id],
        );
        await deliverInApp(worker, e.event);
        const pid = (await worker.query("SELECT pg_backend_pid() id")).rows[0]
          .id;
        await owner.query("SELECT pg_terminate_backend($1)", [pid]);
        await assert.rejects(worker.query("COMMIT"));
      } finally {
        await worker.end().catch(() => {});
      }
      assert.equal((await state(e.event.id)).status, "pending");
      assert.equal(
        Number(
          (
            await one(
              "SELECT count(*) n FROM notifications WHERE outbox_event_id=$1",
              [e.event.id],
            )
          ).n,
        ),
        0,
      );
      assert.equal(
        (
          await createNotificationOutboxProcessor({
            database: pool,
          }).processOne()
        ).status,
        "delivered",
      );
    });
    await test("concurrent workers deliver one in-app event and one email job", async () => {
      const f = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      const p = createNotificationOutboxProcessor({ database: pool });
      await Promise.all([p.processOne(), p.processOne(), p.processOne()]);
      assert.equal((await state(e.event.id)).status, "delivered");
      assert.equal(
        Number(
          (
            await one(
              "SELECT count(*) n FROM notifications WHERE outbox_event_id=$1",
              [e.event.id],
            )
          ).n,
        ),
        1,
      );
      assert.ok(await emailState(e.event.id));
    });
    await test("stale processing state is recovered", async () => {
      const f = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      await owner.query(
        "UPDATE notification_outbox SET status='processing',processing_started_at=now()-interval '16 minutes' WHERE id=$1",
        [e.event.id],
      );
      assert.equal(
        (
          await createNotificationOutboxProcessor({
            database: pool,
          }).processOne()
        ).status,
        "delivered",
      );
    });
    await test("deactivated recipient is suppressed before delivery", async () => {
      const f = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      await owner.query("UPDATE users SET is_active=false WHERE id=$1", [
        f.user.id,
      ]);
      assert.equal(
        (
          await createNotificationOutboxProcessor({
            database: pool,
          }).processOne()
        ).status,
        "suppressed",
      );
      assert.equal(await emailState(e.event.id), undefined);
    });
    await test("recipient moving institute loses queued document access", async () => {
      const f = await fixture(),
        foreign = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      await owner.query("UPDATE users SET institute_id=$1 WHERE id=$2", [
        foreign.institute.id,
        f.user.id,
      ]);
      assert.equal(
        (
          await createNotificationOutboxProcessor({
            database: pool,
          }).processOne()
        ).status,
        "suppressed",
      );
    });
    await test("retry exhaustion becomes visible dead letter", async () => {
      const f = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      await owner.query(
        "UPDATE notification_outbox SET retry_count=8 WHERE id=$1",
        [e.event.id],
      );
      assert.equal(
        (
          await createNotificationOutboxProcessor({
            database: pool,
          }).processOne()
        ).status,
        "dead_letter",
      );
    });
    await test("permanent source failure dead-letters without exposing stack", async () => {
      const f = await fixture(),
        e = await tx((c) => enqueue(c, event(f)));
      const p = createNotificationOutboxProcessor({
        database: pool,
        deliver: async () => {
          throw authority.fail("PRIVATE_SOURCE_DETAILS");
        },
      });
      await p.processOne();
      const row = await state(e.event.id);
      assert.equal(row.status, "dead_letter");
      assert.equal(row.last_error, null);
      assert.equal(row.error_category, "PERMANENT_EVENT_FAILURE");
    });
    await owner.query(
      "UPDATE notification_email_deliveries SET status='suppressed'",
    );
    await test("external transport runs outside database transaction and acknowledges", async () => {
      const f = await notice();
      const worker = emails.create({
        database: pool,
        send: async (to, subject, message, options) => {
          assert.equal((await emailState(f.e.id)).status, "processing");
          assert.ok(options.idempotencyKey);
          assert.equal(
            Number(
              (
                await one(
                  "SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'",
                )
              ).n,
            ),
            0,
          );
          return { accepted: [to] };
        },
      });
      assert.equal((await worker.processOne()).status, "delivered");
      assert.ok((await emailState(f.e.id)).acknowledged_at);
    });
    await test("worker crash after email claim recovers expired committed lease", async () => {
      const f = await notice();
      await owner.query(
        "UPDATE notification_email_deliveries SET status='processing',attempt_count=1,lease_token=$1,lease_expires_at=now()-interval '1 second' WHERE outbox_event_id=$2",
        [crypto.randomUUID(), f.e.id],
      );
      let sends = 0;
      await emails
        .create({
          database: pool,
          send: async (to) => {
            sends++;
            return { accepted: [to] };
          },
        })
        .processOne();
      assert.equal(sends, 1);
      assert.equal((await emailState(f.e.id)).attempt_count, 2);
    });
    await test("active email lease is not stolen by concurrent worker", async () => {
      const f = await notice();
      let unblock;
      const gate = new Promise((r) => (unblock = r));
      let entered;
      const ready = new Promise((r) => (entered = r));
      let sends = 0;
      const worker = emails.create({
        database: pool,
        send: async (to) => {
          sends++;
          entered();
          await gate;
          return { accepted: [to] };
        },
      });
      const first = worker.processOne();
      await ready;
      assert.equal(await worker.processOne(), null);
      unblock();
      await first;
      assert.equal(sends, 1);
    });
    await test("SMTP timeout persists failed job with backoff and stable identity", async () => {
      const f = await notice();
      let identity;
      await emails
        .create({
          database: pool,
          send: async (to, s, m, o) => {
            identity = o.messageId;
            throw Error("private transport stack");
          },
        })
        .processOne();
      const failed = await emailState(f.e.id);
      assert.equal(failed.status, "failed");
      assert.equal(failed.error_category, "EXTERNAL_DELIVERY_FAILED");
      assert.ok(
        new Date(failed.next_attempt_at) > new Date(failed.last_attempt_at),
      );
      await due(f.e.id);
      await emails
        .create({
          database: pool,
          send: async (to, s, m, o) => {
            assert.equal(o.messageId, identity);
            return { accepted: [to] };
          },
        })
        .processOne();
      assert.equal((await emailState(f.e.id)).status, "delivered");
    });
    await test("SMTP rejection is terminal; dry-run never acknowledges delivery", async () => {
      const f = await notice();
      await emails
        .create({ database: pool, send: async () => ({ accepted: [] }) })
        .processOne();
      assert.equal((await emailState(f.e.id)).status, "dead_letter");
      const g = await notice();
      await emails
        .create({ database: pool, send: async () => ({ dryRun: true }) })
        .processOne();
      assert.equal((await emailState(g.e.id)).status, "failed");
      assert.equal((await emailState(g.e.id)).acknowledged_at, null);
      await owner.query(
        "UPDATE notification_email_deliveries SET status='suppressed' WHERE outbox_event_id=$1",
        [g.e.id],
      );
    });
    await test("deactivation between in-app delivery and email handoff suppresses email", async () => {
      const f = await notice();
      await owner.query("UPDATE users SET is_active=false WHERE id=$1", [
        f.user.id,
      ]);
      let sends = 0;
      await emails
        .create({
          database: pool,
          send: async () => {
            sends++;
          },
        })
        .processOne();
      assert.equal(sends, 0);
      assert.equal((await emailState(f.e.id)).status, "suppressed");
    });
    await test("ambiguous external acknowledgment retries at least once, not exactly once", async () => {
      const f = await notice();
      let sends = 0;
      let drop = true;
      const failing = {
        connect: async () => {
          const c = await pool.connect();
          return {
            release: () => c.release(),
            query: async (sql, p) => {
              if (
                drop &&
                String(sql).startsWith(
                  "UPDATE notification_email_deliveries SET status=$1",
                ) &&
                p[0] === "delivered"
              ) {
                drop = false;
                throw Error("connection lost before acknowledgment");
              }
              return c.query(sql, p);
            },
          };
        },
      };
      await emails
        .create({
          database: failing,
          send: async (to) => {
            sends++;
            return { accepted: [to] };
          },
        })
        .processOne();
      await due(f.e.id);
      await emails
        .create({
          database: pool,
          send: async (to) => {
            sends++;
            return { accepted: [to] };
          },
        })
        .processOne();
      assert.equal(sends, 2);
      assert.equal((await emailState(f.e.id)).status, "delivered");
      assert.equal(
        Number(
          (
            await one(
              "SELECT count(*) n FROM notifications WHERE outbox_event_id=$1",
              [f.e.id],
            )
          ).n,
        ),
        1,
      );
    });
    await test("read-only diagnostics preserve historical rows and isolate institute", async () => {
      const f = await fixture(),
        g = await fixture();
      const before = (await one("SELECT count(*)::int n FROM audit_logs")).n;
      const report = await tx(async (c) => {
        await c.query("SET TRANSACTION READ ONLY");
        return diagnostic.diagnostic(c, f.institute.id);
      });
      assert.ok(report.cutover.length);
      assert.ok(!JSON.stringify(report).includes(g.user.email));
      assert.equal(
        (await one("SELECT count(*)::int n FROM audit_logs")).n,
        before,
      );
    });
    await test("unauthorized operational viewer is rejected even with forged claims", async () => {
      const f = await fixture();
      await assert.rejects(
        diagnostic.forActor(
          { id: f.user.id, permissions: ["operations.events.view"] },
          pool,
        ),
        { statusCode: 403 },
      );
      await owner.query(
        "INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE code='operations.events.view'",
        [f.user.id],
      );
      assert.ok(
        (await diagnostic.forActor({ id: f.user.id }, pool)).cutover.length,
      );
    });

    await test("historical missing audit and outbox are reported without fabricated evidence", async () => {
      const f = await fixture(),
        g = await fixture();
      const supplier = await one(
        "INSERT INTO suppliers(name,status) VALUES('Diagnostic fixture','active') RETURNING id",
      );
      const headers = [];
      for (const source of [f, g])
        headers.push(
          await one(
            "INSERT INTO purchase_orders(request_id,supplier_id,po_number,status,currency,total_amount) VALUES($1,$2,$3,'PO_ISSUED','USD',3) RETURNING id",
            [source.request.id, supplier.id, source.key],
          ),
        );
      const oldAuditCount = (await one("SELECT count(*) n FROM audit_logs")).n;
      const report = await tx((c) => diagnostic.diagnostic(c, f.institute.id));
      assert.ok(
        report.findings.some(
          (r) =>
            r.domain === "purchase_order" &&
            r.source_id === String(headers[0].id) &&
            r.missing_audit &&
            r.missing_outbox,
        ),
      );
      assert.ok(
        !report.findings.some(
          (r) =>
            r.domain === "purchase_order" &&
            r.source_id === String(headers[1].id),
        ),
      );
      assert.equal(
        (await one("SELECT count(*) n FROM audit_logs")).n,
        oldAuditCount,
      );
    });
    await test("delivered notification read rechecks permissions and safely handles malformed legacy metadata", async () => {
      const f = await notice(),
        visibility = require("../utils/notificationVisibility");
      const visible = async () => {
        const ctx = await visibility.context(owner, f.user.id);
        return owner.query(
          `SELECT n.id FROM notifications n LEFT JOIN notification_outbox o ON o.id=n.outbox_event_id WHERE n.user_id=$1 AND ${visibility.predicate}`,
          [
            f.user.id,
            ctx.viewAll,
            ctx.rfid,
            ctx.deliveryManager,
            ctx.technicalManager,
          ],
        );
      };
      assert.equal((await visible()).rowCount, 1);
      const replacement = await one(
        "INSERT INTO users(name,email,password,role,institute_id,is_active) VALUES('Other requester',$1,'test','EVENT_TEST',$2,true) RETURNING id",
        [crypto.randomUUID() + "@disposable.test", f.institute.id],
      );
      await owner.query("UPDATE requests SET requester_id=$1 WHERE id=$2", [
        replacement.id,
        f.request.id,
      ]);
      assert.equal((await visible()).rowCount, 0);
      await owner.query(
        "INSERT INTO notifications(user_id,title,message,metadata) VALUES($1,'Malformed historical link','Do not disclose',$2)",
        [f.user.id, { requestId: "bad-not-a-number" }],
      );
      assert.equal((await visible()).rowCount, 0);
    });
    await test("new event cutover is immutable and browser grants are absent", async () => {
      await assert.rejects(
        owner.query(
          "UPDATE event_reliability_cutovers SET installed_at=now() WHERE version='7c'",
        ),
        /EVENT_RELIABILITY_CUTOVER_IMMUTABLE/,
      );
      for (const role of ["anon", "authenticated"])
        assert.equal(
          (
            await one(
              "SELECT has_table_privilege($1,'notification_email_deliveries','SELECT') allowed",
              [role],
            )
          ).allowed,
          false,
        );
    });

    const approvalFixture = async () => {
      const f = await fixture();
      const approval = await one(
        "INSERT INTO approvals(request_id,approval_level,approver_id,status,is_active) VALUES($1,1,$2,'Pending',true) RETURNING id",
        [f.request.id, f.user.id],
      );
      return { ...f, approval };
    };
    const reject = async (f) => {
      let error, result;
      const res = {
        status() {
          return this;
        },
        json(value) {
          result = value;
          return this;
        },
      };
      await require("../controllers/approvalsController").handleApprovalDecision(
        {
          params: { id: String(f.approval.id) },
          body: {
            status: "Rejected",
            comments: "Reviewed rejection",
            approver_id: 999999,
          },
          user: { ...f.user, hasPermission: () => false },
        },
        res,
        (e) => {
          error = e;
        },
      );
      if (error) throw error;
      return result;
    };
    await test("legacy approval decision records server actor and transactionally queues rejection", async () => {
      const f = await approvalFixture();
      await reject(f);
      assert.equal(
        (await one("SELECT status FROM requests WHERE id=$1", [f.request.id]))
          .status,
        "Rejected",
      );
      assert.equal(
        (
          await one(
            "SELECT actor_id FROM audit_logs WHERE action='APPROVAL_DECIDED' AND target_id=$1",
            [f.approval.id],
          )
        ).actor_id,
        f.user.id,
      );
      assert.ok(
        Number(
          (
            await one(
              "SELECT count(*) n FROM notification_outbox WHERE entity_type='request' AND entity_id=$1",
              [String(f.request.id)],
            )
          ).n,
        ) > 0,
      );
    });
    await test("legacy decision audit failure rolls back approval, request and required notices", async () => {
      const f = await approvalFixture();
      await block("audit_logs", () =>
        assert.rejects(reject(f), /INJECTED_EVENT_FAILURE/),
      );
      assert.equal(
        (await one("SELECT status FROM approvals WHERE id=$1", [f.approval.id]))
          .status,
        "Pending",
      );
      assert.equal((await counts(f)).status, "Submitted");
      assert.equal(
        Number(
          (
            await one(
              "SELECT count(*) n FROM notification_outbox WHERE entity_type='request' AND entity_id=$1",
              [String(f.request.id)],
            )
          ).n,
        ),
        0,
      );
    });
    await test("concurrent legacy decisions cannot duplicate audit or decision", async () => {
      const f = await approvalFixture();
      const results = await Promise.allSettled([reject(f), reject(f)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        Number(
          (
            await one(
              "SELECT count(*) n FROM audit_logs WHERE action='APPROVAL_DECIDED' AND target_id=$1",
              [f.approval.id],
            )
          ).n,
        ),
        1,
      );
    });
    await test("scheduled activation audit and notices commit with activation", async () => {
      const f = await approvalFixture();
      await owner.query(
        "UPDATE requests SET status='Scheduled',scheduled_for=now()-interval '1 hour' WHERE id=$1",
        [f.request.id],
      );
      await owner.query("UPDATE approvals SET is_active=false WHERE id=$1", [
        f.approval.id,
      ]);
      await require("../controllers/utils/processScheduledRequests")();
      assert.equal((await counts(f)).status, "Submitted");
      assert.equal(
        Number(
          (
            await one(
              "SELECT count(*) n FROM audit_logs WHERE target_id=$1 AND action='REQUEST_SCHEDULED_ACTIVATED'",
              [f.request.id],
            )
          ).n,
        ),
        1,
      );
      assert.equal(
        (
          await one(
            "SELECT payload->>'approvalId' approval FROM notification_outbox WHERE idempotency_key LIKE $1",
            [`%scheduled:${f.request.id}:${f.approval.id}%`],
          )
        ).approval,
        String(f.approval.id),
      );
    });

    await test("external retry exhaustion is visible and cannot silently drop work", async () => {
      await owner.query(
        "UPDATE notification_email_deliveries SET status='suppressed' WHERE status IN ('pending','failed')",
      );
      const f = await notice();
      await owner.query(
        "UPDATE notification_email_deliveries SET attempt_count=8 WHERE outbox_event_id=$1",
        [f.e.id],
      );
      let sends = 0;
      await emails
        .create({
          database: pool,
          send: async () => {
            sends++;
          },
        })
        .processOne();
      assert.equal(sends, 0);
      assert.equal((await emailState(f.e.id)).status, "dead_letter");
    });

    await test("cancelled request cannot deliver a stale approval action", async () => {
      const f = await approvalFixture();
      const e = await tx((c) =>
        enqueue(c, {
          ...event(f),
          payload: { title: "Approval required", approvalId: f.approval.id },
        }),
      );
      await owner.query("UPDATE requests SET status='Cancelled' WHERE id=$1", [
        f.request.id,
      ]);
      assert.equal(await tx((c) => authority.recipient(c, e.event)), null);
    });
    await test("unsupported or inherited source names cannot enqueue unscoped user notices", async () => {
      const f = await fixture();
      for (const entityType of ["unsupported_source", "toString"])
        await assert.rejects(
          tx((c) => enqueue(c, { ...event(f), entityType })),
          { code: "EVENT_SOURCE_SCOPE_REQUIRED" },
        );
    });
    console.log("Event reliability PostgreSQL scenarios passed: " + passed);
  } finally {
    await pool.end();
    await require("../config/db").end();
  }
}
module.exports = { run };
