"use strict";
const assert = require("node:assert/strict"),
  crypto = require("crypto");
const { Pool, Client } = require("pg");
async function run(owner, url) {
  const target = require("./disposableDatabase").disposableDatabaseUrl(url);
  process.env.DATABASE_URL = target;
  process.env.NODE_ENV = "test";
  const pool = new Pool({ connectionString: target, max: 12 });
  const Repository = require("../repositories/fixedAssetRepository"),
    Processor = require("../services/rfidEventProcessor"),
    Jobs = require("../services/rfidJobService");
  const {
    RfidIngestionService,
    RfidService,
  } = require("../services/rfidService");
  const { writeAuditEvent } = require("../services/auditService");
  const repo = new Repository(pool),
    ingest = new RfidIngestionService(repo),
    jobs = new Jobs(repo);
  let count = 0,
    tick = 0;
  const row = async (sql, params = []) =>
    (await owner.query(sql, params)).rows[0];
  const state = (id) => row("SELECT * FROM rfid_read_events WHERE id=$1", [id]);
  const fixture = async () => {
    const key = crypto.randomBytes(6).toString("hex");
    const institute = await row(
      "INSERT INTO institutes(name) VALUES($1) RETURNING id",
      ["RFID recovery " + key],
    );
    const user = await row(
      "INSERT INTO users(name,email,password,role,institute_id,is_active) VALUES('RFID operator',$1,'not-a-login-secret','RFID_TEST_OPERATOR',$2,true) RETURNING id",
      [key + "@disposable.test", institute.id],
    );
    await owner.query(
      "INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE code='rfid.manage-infrastructure'",
      [user.id],
    );
    const location = await row(
      "INSERT INTO asset_locations(institute_id,code,name,location_type) VALUES($1,'ROOM','RFID lab','ROOM') RETURNING id",
      [institute.id],
    );
    const reader = await row(
      "INSERT INTO rfid_readers(institute_id,code,name,reader_type,device_identifier,location_id,is_active) VALUES($1,'TEST','Test reader','FIXED',$2,$3,true) RETURNING *",
      [institute.id, key, location.id],
    );
    const client = await row(
      "INSERT INTO rfid_integration_clients(institute_id,client_identifier,credential_hash,scopes,enabled) VALUES($1,$2,$3,ARRAY['rfid:ingest'],true) RETURNING *",
      [institute.id, key, "0".repeat(64)],
    );
    return {
      institute,
      reader,
      client,
      user,
      location,
      ctx: { instituteId: institute.id, userId: user.id },
    };
  };
  const upload = async (f, extra = {}) => {
    const input = {
      readerCode: "TEST",
      epc: "EPC-" + crypto.randomBytes(8).toString("hex").toUpperCase(),
      timestamp: new Date(Date.UTC(2026, 10, 5, 0, 0, tick++)).toISOString(),
      ...extra,
    };
    const result = await ingest.ingest([input], f.client);
    return { read: result.events[0], input, result };
  };
  const expire = (id) =>
    owner.query(
      "UPDATE rfid_read_events SET processing_lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
  const due = (id) =>
    owner.query(
      "UPDATE rfid_read_events SET processing_next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
  const counts = async (id) =>
    row(
      `SELECT (SELECT count(*)::int FROM rfid_processing_attempts WHERE read_event_id=$1) attempts,(SELECT count(*)::int FROM audit_logs WHERE action='RFID_READ_PROCESSED' AND target_id=$1) audits,(SELECT observation_count FROM rfid_business_events WHERE id=(SELECT business_event_id FROM rfid_read_events WHERE id=$1)) observations`,
      [id],
    );
  const test = async (name, fn) => {
    // Isolate unfinished disposable technical jobs from the one global-worker test.
    await owner.query(
      "UPDATE rfid_read_events SET processing_status='IGNORED',processing_lease_token=NULL,processing_worker_id=NULL,processing_lease_expires_at=NULL WHERE processing_status IN ('PENDING','FAILED','PROCESSING')",
    );
    await fn();
    count++;
    console.log("PASS RFID recovery " + name);
  };
  try {
    await test("normal processing commits one observation and audit atomically", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      assert.equal((await new Processor(repo).process(1, f.ctx)).processed, 1);
      assert.equal((await state(read.id)).processing_status, "PROCESSED");
      assert.deepEqual(await counts(read.id), {
        attempts: 1,
        audits: 1,
        observations: 1,
      });
    });
    await test("duplicate upload uses source identity with or without an external event id", async () => {
      const f = await fixture(),
        { input } = await upload(f, { externalEventId: "device-1" });
      assert.equal((await ingest.ingest([input], f.client)).duplicates, 1);
      const noId = { ...input, externalEventId: undefined };
      assert.equal((await ingest.ingest([noId], f.client)).accepted, 1);
      assert.equal((await ingest.ingest([noId], f.client)).duplicates, 1);
      assert.equal(
        (
          await ingest.ingest(
            [{ ...input, externalEventId: "device-2" }],
            f.client,
          )
        ).accepted,
        1,
      );
      await assert.rejects(
        () => ingest.ingest([{ ...input, rssi: -50 }], f.client),
        (e) => e.code === "RFID_EVENT_IDENTITY_CONFLICT",
      );
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM rfid_read_events WHERE institute_id=$1",
            [f.institute.id],
          )
        ).n,
        3,
      );
    });
    await test("concurrent workers atomically claim each read once", async () => {
      const f = await fixture();
      for (let i = 0; i < 12; i++) await upload(f);
      const result = await Promise.all([
        new Processor(repo).process(20, f.ctx),
        new Processor(repo).process(20, f.ctx),
      ]);
      assert.equal(
        result.reduce((n, r) => n + r.processed, 0),
        12,
      );
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM rfid_read_events WHERE institute_id=$1 AND processing_status='PROCESSED'",
            [f.institute.id],
          )
        ).n,
        12,
      );
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM rfid_processing_attempts WHERE institute_id=$1",
            [f.institute.id],
          )
        ).n,
        12,
      );
    });
    await test("worker crash after claim is recovered by a new worker after expiry", async () => {
      const f = await fixture(),
        { read } = await upload(f),
        p = new Processor(repo),
        claim = await p.claim(f.ctx);
      assert.equal(claim.id, read.id);
      assert.equal((await new Processor(repo).process(1, f.ctx)).selected, 0);
      await expire(read.id);
      assert.equal((await new Processor(repo).process(1, f.ctx)).processed, 1);
      assert.deepEqual(
        (await jobs.attempts(read.id, f.ctx)).map((a) => a.outcome),
        ["LEASE_EXPIRED", "COMPLETED"],
      );
      assert.equal((await state(read.id)).processing_recovery_count, 1);
    });
    await test("disconnect before commit rolls back business changes and permits safe resumption", async () => {
      const f = await fixture(),
        { read } = await upload(f),
        p = new Processor(repo),
        claim = await p.claim(f.ctx),
        db = new Client({ connectionString: target });
      await db.connect();
      await db.query("BEGIN");
      await p.processOne(new Repository(db), read.id, claim, f.ctx);
      await db.end();
      assert.equal((await state(read.id)).business_event_id, null);
      assert.equal((await counts(read.id)).audits, 0);
      await expire(read.id);
      await new Processor(repo).process(1, f.ctx);
      assert.deepEqual(await counts(read.id), {
        attempts: 2,
        audits: 1,
        observations: 1,
      });
    });
    await test("lost commit acknowledgement cannot replay a committed observation", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      let calls = 0;
      const uncertain = {
        transaction: async (work) => {
          const result = await repo.transaction(work);
          if (++calls === 2)
            throw Object.assign(new Error("ack lost"), { code: "ECONNRESET" });
          return result;
        },
      };
      const result = await new Processor(uncertain).process(1, f.ctx);
      assert.equal(result.failed, 1);
      assert.equal((await new Processor(repo).process(1, f.ctx)).selected, 0);
      assert.deepEqual(await counts(read.id), {
        attempts: 1,
        audits: 1,
        observations: 1,
      });
    });
    await test("legacy processing without a lease is explicitly recovered without raw-data backfill", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      await owner.query(
        "UPDATE rfid_read_events SET processing_status='PROCESSING',processing_attempts=1,source_fingerprint=NULL WHERE id=$1",
        [read.id],
      );
      await new Processor(repo).process(1, f.ctx);
      const after = await state(read.id);
      assert.equal(after.processing_status, "PROCESSED");
      assert.equal(after.processing_recovery_count, 1);
      assert.equal(after.epc, read.epc);
      assert.equal(after.source_fingerprint, null);
    });
    await test("active lease and in-transaction row lock cannot be stolen", async () => {
      const f = await fixture(),
        { read } = await upload(f),
        p = new Processor(repo),
        claim = await p.claim(f.ctx);
      await assert.rejects(
        () => jobs.recover(read.id, "Recover active job", f.ctx),
        (e) => e.code === "RFID_LEASE_ACTIVE",
      );
      const db = await pool.connect();
      await db.query("BEGIN");
      try {
        await db.query(
          "SELECT id FROM rfid_read_events WHERE id=$1 FOR UPDATE",
          [read.id],
        );
        await db.query(
          "UPDATE rfid_read_events SET processing_lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [read.id],
        );
        assert.equal(await new Processor(repo).claim(f.ctx), null);
      } finally {
        await db.query("ROLLBACK");
        db.release();
      }
      assert.equal((await state(read.id)).processing_lease_token, claim.token);
    });
    await test("retry count is bounded and backoff grows to terminal failure", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      const p = new Processor(repo, {
        audit: (e) =>
          e.action === "RFID_READ_PROCESSED"
            ? Promise.reject(Error("Injected processing audit failure"))
            : writeAuditEvent(e),
      });
      for (let attempt = 1; attempt <= 5; attempt++) {
        await p.process(1, f.ctx);
        const current = await state(read.id);
        assert.equal(current.processing_attempts, attempt);
        if (attempt < 5) {
          assert.equal(current.processing_status, "FAILED");
          const remaining = (
            await row(
              "SELECT extract(epoch FROM ($1::timestamptz-clock_timestamp()))::float remaining",
              [current.processing_next_attempt_at],
            )
          ).remaining;
          assert(remaining > 5 * 2 ** (attempt - 1) - 3);
          await due(read.id);
        } else assert.equal(current.processing_status, "DEAD_LETTER");
      }
      assert.equal((await new Processor(repo).process(1, f.ctx)).selected, 0);
      assert.equal((await counts(read.id)).audits, 0);
      await assert.rejects(
        () => jobs.recover(read.id, "Reset exhausted work", f.ctx),
        (e) => e.code === "RFID_RECOVERY_REQUIRES_REVIEW",
      );
    });
    await test("partial batch failure retries only the uncommitted read", async () => {
      const f = await fixture(),
        a = await upload(f),
        b = await upload(f),
        c = await upload(f),
        p = new Processor(repo);
      const apply = p.applyObservation.bind(p);
      p.applyObservation = (tx, read) =>
        read.id === b.read.id
          ? Promise.reject(Error("one failed read"))
          : apply(tx, read);
      const result = await p.process(3, f.ctx);
      assert.equal(result.processed, 2);
      assert.equal(result.failed, 1);
      await due(b.read.id);
      await new Processor(repo).process(3, f.ctx);
      for (const r of [a, b, c])
        assert.equal((await counts(r.read.id)).observations, 1);
      const before = (
        await row(
          "SELECT count(*)::int n FROM rfid_read_events WHERE institute_id=$1",
          [f.institute.id],
        )
      ).n;
      await assert.rejects(() =>
        ingest.ingest(
          [
            { ...a.input, epc: "NEW-VALID" },
            { ...a.input, timestamp: "ambiguous" },
          ],
          f.client,
        ),
      );
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM rfid_read_events WHERE institute_id=$1",
            [f.institute.id],
          )
        ).n,
        before,
      );
    });
    await test("scheduler restart drains recoverable work and graceful shutdown stops new claims", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      const claim = await new Processor(repo).claim(f.ctx);
      await expire(claim.id);
      const { startRfidWorker } = require("../jobs/rfidWorker");
      const worker = startRfidWorker({
        processor: new Processor(repo),
        pollMilliseconds: 20,
      });
      for (
        let i = 0;
        i < 100 && (await state(read.id)).processing_status !== "PROCESSED";
        i++
      )
        await new Promise((r) => setTimeout(r, 10));
      await worker.stop();
      assert.equal((await state(read.id)).processing_status, "PROCESSED");
      const next = await upload(f);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal((await state(next.read.id)).processing_status, "PENDING");
    });
    await test("terminated PostgreSQL connection rolls back and a reconnect recovers", async () => {
      const f = await fixture(),
        { read } = await upload(f),
        p = new Processor(repo),
        claim = await p.claim(f.ctx),
        db = new Client({ connectionString: target });
      db.on("error", () => {});
      await db.connect();
      await db.query("BEGIN");
      const pid = (await db.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      await p.processOne(new Repository(db), read.id, claim, f.ctx);
      await owner.query("SELECT pg_terminate_backend($1)", [pid]);
      await assert.rejects(() => db.query("COMMIT"));
      await db.end();
      assert.equal((await state(read.id)).business_event_id, null);
      await expire(read.id);
      await new Processor(repo).process(1, f.ctx);
      assert.equal((await counts(read.id)).observations, 1);
    });
    await test("foreign institute is not claimable or visible through direct job ids", async () => {
      const a = await fixture(),
        b = await fixture(),
        { read } = await upload(b);
      assert.equal((await new Processor(repo).process(1, a.ctx)).selected, 0);
      assert.equal((await jobs.list({}, a.ctx)).pagination.total, 0);
      await assert.rejects(
        () => jobs.attempts(read.id, a.ctx),
        (e) => e.statusCode === 404,
      );
      await assert.rejects(
        () => jobs.recover(read.id, "Foreign job recovery", a.ctx),
        (e) => e.statusCode === 404,
      );
    });
    await test("warehouse and session authority cannot be supplied by reader uploads", async () => {
      const f = await fixture();
      for (const key of [
        "warehouseId",
        "warehouse_id",
        "inventorySessionId",
        "assetId",
        "institute_id",
      ])
        await assert.rejects(
          () => upload(f, { [key]: 999999 }),
          (e) => e.code === "RFID_CONTEXT_NOT_SUPPORTED",
        );
      assert.equal((await jobs.list({}, f.ctx)).pagination.total, 0);
    });
    await test("unauthorized or deactivated operator cannot process or recover work", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      await owner.query("DELETE FROM user_permissions WHERE user_id=$1", [
        f.user.id,
      ]);
      await assert.rejects(
        () => jobs.recover(read.id, "Unauthorized recovery", f.ctx),
        (e) => e.statusCode === 403,
      );
      await assert.rejects(
        () => new Processor(repo).process(1, f.ctx),
        (e) => e.statusCode === 403,
      );
      await owner.query(
        "INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE code='rfid.manage-infrastructure'",
        [f.user.id],
      );
      await owner.query("UPDATE users SET is_active=false WHERE id=$1", [
        f.user.id,
      ]);
      await assert.rejects(
        () => jobs.list({}, f.ctx),
        (e) => e.statusCode === 403,
      );
      assert.equal((await state(read.id)).processing_attempts, 0);
    });
    await test("duplicate EPC reads retain useful distinct observations but not upload retries", async () => {
      const f = await fixture(),
        a = await upload(f, { epc: "DUPLICATE-EPC" }),
        b = await upload(f, { epc: "DUPLICATE-EPC" });
      await ingest.ingest([a.input, b.input], f.client);
      await new Processor(repo).process(10, f.ctx);
      const business = await row(
        "SELECT * FROM rfid_business_events WHERE institute_id=$1",
        [f.institute.id],
      );
      assert.equal(business.observation_count, 2);
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM asset_exceptions WHERE institute_id=$1",
            [f.institute.id],
          )
        ).n,
        1,
      );
    });
    const knownAsset = async (f) => {
      const category = await row(
        "INSERT INTO asset_categories(institute_id,code,name) VALUES($1,'CONTROLLED','Controlled') RETURNING id",
        [f.institute.id],
      );
      const asset = await row(
        "INSERT INTO assets(institute_id,asset_number,asset_class,asset_category_id,description,acquisition_method,ownership_type,condition,operational_status,reconciliation_status,creation_source,current_location_id) VALUES($1,$2,'CONTROLLED',$3,'Test asset','LEGACY','INSTITUTE_OWNED','UNKNOWN','IN_STORAGE','UNVERIFIED','LEGACY_RECOVERY',$4) RETURNING *",
        [
          f.institute.id,
          "ASSET-" + crypto.randomBytes(4).toString("hex"),
          category.id,
          f.location.id,
        ],
      );
      const tag = await row(
        "INSERT INTO asset_tags(institute_id,asset_id,tag_type,epc,tag_status) VALUES($1,$2,'RFID_UHF',$3,'ACTIVE') RETURNING *",
        [
          f.institute.id,
          asset.id,
          "TAG-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
        ],
      );
      return { asset, tag };
    };
    await test("asset ownership mismatch and revoked source authority fail closed", async () => {
      const a = await fixture(),
        b = await fixture(),
        known = await knownAsset(a),
        foreign = await knownAsset(b),
        { read } = await upload(a, { epc: known.tag.epc });
      await owner.query("UPDATE rfid_read_events SET asset_id=$1 WHERE id=$2", [
        foreign.asset.id,
        read.id,
      ]);
      await new Processor(repo).process(1, a.ctx);
      assert.equal(
        (await state(read.id)).processing_error_code,
        "RFID_IDENTITY_CHANGED",
      );
      assert.equal((await state(read.id)).business_event_id, null);
      const next = await upload(a);
      await owner.query(
        "UPDATE rfid_integration_clients SET enabled=false WHERE id=$1",
        [a.client.id],
      );
      await new Processor(repo).process(1, a.ctx);
      assert.equal(
        (await state(next.read.id)).processing_status,
        "DEAD_LETTER",
      );
    });
    await test("audit failure rolls back observation, exception and completion together", async () => {
      const f = await fixture(),
        { read } = await upload(f),
        p = new Processor(repo, {
          audit: (e) =>
            e.action === "RFID_READ_PROCESSED"
              ? Promise.reject(Error("secret internal stack"))
              : writeAuditEvent(e),
        });
      await p.process(1, f.ctx);
      assert.equal((await state(read.id)).processing_status, "FAILED");
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM rfid_business_events WHERE institute_id=$1",
            [f.institute.id],
          )
        ).n,
        0,
      );
      const visible = await jobs.list({}, f.ctx);
      assert(!JSON.stringify(visible).includes("secret"));
      assert.equal(visible.data[0].processing_error_code, "PROCESSING_FAILED");
      await due(read.id);
      await new Processor(repo).process(1, f.ctx);
      assert.equal((await counts(read.id)).audits, 1);
    });
    await test("RFID retries do not duplicate notifications and canonical outbox retries remain idempotent", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      const {
        enqueueNotification,
      } = require("../services/notificationOutboxService");
      const event = {
        type: "RFID_TEST_NOTICE",
        entityType: "RFID_READ",
        entityId: read.id,
        userId: f.user.id,
        idempotencyKey: "RFID-test-" + read.id,
        payload: { message: "Disposable in-app notice" },
      };
      const first = await enqueueNotification(owner, event);
      assert.equal((await enqueueNotification(owner, event)).created, false);
      const {
        createNotificationOutboxProcessor,
        deliverInApp,
      } = require("../services/notificationOutboxProcessor");
      let once = true;
      const delivery = createNotificationOutboxProcessor({
        database: pool,
        deliver: async (db, e) => {
          await deliverInApp(db, e);
          if (once) {
            once = false;
            throw Error("after insert before commit");
          }
        },
      });
      assert.equal((await delivery.processOne()).status, "failed");
      await owner.query(
        "UPDATE notification_outbox SET next_attempt_at=now() WHERE id=$1",
        [first.event.id],
      );
      assert.equal((await delivery.processOne()).status, "delivered");
      await new Processor(repo).process(1, f.ctx);
      await new Processor(repo).process(1, f.ctx);
      await deliverInApp(owner, first.event);
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM notifications WHERE outbox_event_id=$1",
            [first.event.id],
          )
        ).n,
        1,
      );
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM notification_outbox WHERE idempotency_key=$1",
            [event.idempotencyKey],
          )
        ).n,
        1,
      );
    });
    await test("RFID observation never changes stock, asset location, movement or count reconciliation", async () => {
      const f = await fixture(),
        known = await knownAsset(f);
      const stock = await row(
        "INSERT INTO stock_items(name,unit) VALUES('Preserved RFID warehouse stock','EA') RETURNING id",
      );
      const warehouse = await row(
        "INSERT INTO warehouses(name,institute_id,is_active) VALUES('Preserved RFID warehouse',$1,true) RETURNING id",
        [f.institute.id],
      );
      await owner.query(
        "INSERT INTO warehouse_stock_levels(warehouse_id,stock_item_id,item_name,quantity,stock_status) VALUES($1,$2,'Preserved RFID warehouse stock',12,'AVAILABLE')",
        [warehouse.id, stock.id],
      );
      const tables = [
        "assets",
        "asset_movements",
        "inventory_transactions",
        "inventory_transaction_allocations",
        "warehouse_stock_levels",
        "department_stock_levels",
        "asset_inventory_expected_assets",
        "asset_inventory_observations",
        "asset_inventory_findings",
        "asset_inventory_resolutions",
        "custody_records",
      ];
      const hash = async () =>
        Object.fromEntries(
          await Promise.all(
            tables.map(async (t) => [
              t,
              (
                await row(
                  `SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) digest FROM public.${t} x`,
                )
              ).digest,
            ]),
          ),
        );
      const before = await hash();
      const { read } = await upload(f, { epc: known.tag.epc });
      await new Processor(repo).process(1, f.ctx);
      assert.deepEqual(await hash(), before);
      assert.equal((await counts(read.id)).observations, 1);
    });
    await test("manual recovery is scoped, audited, idempotent and does not reset attempt limits", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      await owner.query(
        "UPDATE rfid_read_events SET processing_status='FAILED',processing_attempts=1 WHERE id=$1",
        [read.id],
      );
      assert.equal(
        (
          await jobs.recover(
            read.id,
            "Operator reviewed transient failure",
            f.ctx,
          )
        ).changed,
        true,
      );
      assert.equal(
        (await jobs.recover(read.id, "Same reviewed recovery", f.ctx)).changed,
        false,
      );
      assert.equal((await state(read.id)).processing_attempts, 1);
      assert.equal(
        (
          await row(
            "SELECT count(*)::int n FROM audit_logs WHERE action='RFID_PROCESSING_MANUAL_RECOVERY' AND target_id=$1",
            [read.id],
          )
        ).n,
        1,
      );
    });
    await test("stale worker fencing cannot overwrite a later successful attempt", async () => {
      const f = await fixture(),
        { read } = await upload(f),
        old = new Processor(repo),
        claim = await old.claim(f.ctx);
      await expire(read.id);
      await new Processor(repo).process(1, f.ctx);
      assert.equal(
        await repo.transaction((tx) =>
          old.processOne(tx, read.id, claim, f.ctx),
        ),
        false,
      );
      assert.equal(
        await old.failClaim(claim, Error("late failure"), f.ctx),
        false,
      );
      assert.deepEqual(await counts(read.id), {
        attempts: 2,
        audits: 1,
        observations: 1,
      });
    });
    await test("finalized attempt history is immutable", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      await new Processor(repo).process(1, f.ctx);
      await assert.rejects(
        () =>
          owner.query(
            "DELETE FROM rfid_processing_attempts WHERE read_event_id=$1",
            [read.id],
          ),
        /RFID_ATTEMPT_HISTORY_IMMUTABLE/,
      );
      await assert.rejects(
        () =>
          owner.query(
            "UPDATE rfid_processing_attempts SET outcome='RETRY' WHERE read_event_id=$1",
            [read.id],
          ),
        /RFID_ATTEMPT_HISTORY_IMMUTABLE/,
      );
    });
    await test("crash at the final allowed attempt becomes a visible terminal state", async () => {
      const f = await fixture(),
        { read } = await upload(f);
      await owner.query(
        "UPDATE rfid_read_events SET processing_attempts=4 WHERE id=$1",
        [read.id],
      );
      await new Processor(repo).claim(f.ctx);
      await expire(read.id);
      const result = await new Processor(repo).process(1, f.ctx);
      assert.equal(result.terminal, 1);
      assert.equal((await state(read.id)).processing_status, "DEAD_LETTER");
      assert.equal((await state(read.id)).processing_attempts, 5);
      assert.equal(
        (await jobs.attempts(read.id, f.ctx))[0].outcome,
        "LEASE_EXPIRED",
      );
    });
    await test("inconsistent foreign reader reference cannot widen execution scope", async () => {
      const a = await fixture(),
        b = await fixture(),
        { read } = await upload(a);
      await owner.query(
        "UPDATE rfid_read_events SET reader_id=$1 WHERE id=$2",
        [b.reader.id, read.id],
      );
      await new Processor(repo).process(1, a.ctx);
      const after = await state(read.id);
      assert.equal(after.processing_error_code, "RFID_SCOPE_MISMATCH");
      assert.equal(after.processing_status, "DEAD_LETTER");
      assert.equal(after.business_event_id, null);
      // Nullable references must not treat a real legacy key of zero as absent.
      await owner.query(
        "INSERT INTO asset_locations(id,institute_id,code,name,location_type) VALUES(0,$1,'ZERO-FOREIGN','Foreign legacy key','ROOM')",
        [b.institute.id],
      );
      const next = await upload(a);
      await owner.query("UPDATE rfid_readers SET location_id=0 WHERE id=$1", [
        a.reader.id,
      ]);
      await new Processor(repo).process(1, a.ctx);
      assert.equal(
        (await state(next.read.id)).processing_error_code,
        "RFID_SCOPE_MISMATCH",
      );
    });
    await test("invalid neighboring evidence cannot influence a valid read interpretation", async () => {
      const a = await fixture(),
        b = await fixture(),
        known = await knownAsset(a),
        foreign = await knownAsset(b);
      const portal = await row(
        "INSERT INTO rfid_portals(institute_id,code,name,portal_type,from_location_id,to_location_id,enabled) VALUES($1,'DOOR','Door','DOORWAY',$2,$2,true) RETURNING id",
        [a.institute.id, a.location.id],
      );
      for (const [port, role] of [
        [1, "SIDE_A"],
        [2, "SIDE_B"],
      ]) {
        const antenna = await row(
          "INSERT INTO rfid_antennas(institute_id,reader_id,antenna_port,name,enabled) VALUES($1,$2,$3,$4,true) RETURNING id",
          [a.institute.id, a.reader.id, port, "Side " + port],
        );
        await owner.query(
          "INSERT INTO rfid_portal_antennas(portal_id,antenna_id,direction_role) VALUES($1,$2,$3)",
          [portal.id, antenna.id, role],
        );
      }
      const first = await upload(a, { epc: known.tag.epc, antennaPort: 1 }),
        bad = await upload(a, { epc: known.tag.epc, antennaPort: 2 });
      await owner.query("UPDATE rfid_read_events SET asset_id=$1 WHERE id=$2", [
        foreign.asset.id,
        bad.read.id,
      ]);
      const historical = await row(
        "INSERT INTO rfid_business_events(institute_id,event_type,asset_id,asset_tag_id,epc,portal_id,reader_id,direction,first_seen_at,last_seen_at,observation_count,authorization_status,status) VALUES($1,'ASSET_SEEN',$2,$3,$4,$5,$6,'UNKNOWN',$7,$7,7,'NOT_APPLICABLE','OPEN') RETURNING id",
        [
          a.institute.id,
          foreign.asset.id,
          known.tag.id,
          known.tag.epc,
          portal.id,
          a.reader.id,
          first.read.read_timestamp,
        ],
      );
      await new Processor(repo).process(2, a.ctx);
      const event = await row(
        "SELECT * FROM rfid_business_events WHERE id=$1",
        [(await state(first.read.id)).business_event_id],
      );
      assert.equal(event.direction, "UNKNOWN");
      assert.equal(event.event_type, "ASSET_SEEN");
      assert.equal(event.observation_count, 1);
      assert.equal(event.asset_id, known.asset.id);
      assert.equal(
        (
          await row(
            "SELECT observation_count n FROM rfid_business_events WHERE id=$1",
            [historical.id],
          )
        ).n,
        7,
      );
      assert.equal(
        (await state(bad.read.id)).processing_error_code,
        "RFID_IDENTITY_CHANGED",
      );
    });
    await test("historical linked evidence is not replayed when technical status is inconsistent", async () => {
      const f = await fixture(),
        first = await upload(f);
      await new Processor(repo).process(1, f.ctx);
      const businessId = (await state(first.read.id)).business_event_id,
        next = await upload(f);
      await owner.query(
        "UPDATE rfid_read_events SET business_event_id=$1 WHERE id=$2",
        [businessId, next.read.id],
      );
      await new Processor(repo).process(1, f.ctx);
      assert.equal(
        (await state(next.read.id)).processing_error_code,
        "RFID_EVIDENCE_REVIEW_REQUIRED",
      );
      assert.equal(
        (
          await row(
            "SELECT observation_count n FROM rfid_business_events WHERE id=$1",
            [businessId],
          )
        ).n,
        1,
      );
    });
    await test("actual restricted backend role processes work without owner or schema privileges", async () => {
      const f = await fixture(),
        { read } = await upload(f),
        secret = crypto.randomBytes(24).toString("hex");
      await owner.query(
        `ALTER ROLE purchase_backend LOGIN PASSWORD '${secret}'`,
      );
      const address = new URL(target);
      address.username = "purchase_backend";
      address.password = secret;
      const backend = new Pool({ connectionString: address.toString() });
      try {
        const restricted = new Repository(backend);
        assert.equal(
          (await new Processor(restricted).process(1, f.ctx)).processed,
          1,
        );
        assert.equal(
          (await new Jobs(restricted).list({}, f.ctx)).data[0]
            .processing_status,
          "PROCESSED",
        );
        assert.equal((await counts(read.id)).audits, 1);
      } finally {
        await backend.end();
      }
    });
    console.log(`RFID recovery PostgreSQL scenarios passed: ${count}`);
  } finally {
    await pool.end();
    await require("../config/db").end();
  }
}
module.exports = { run };
