const FixedAssetRepository = require("../repositories/fixedAssetRepository");

const roles = { SIDE_A: "A", APPROACH: "A", SIDE_B: "B", DEPARTURE: "B" };
function deriveDirection(observations, portal) {
  const ordered = [...observations].sort(
    (a, b) => new Date(a.read_timestamp) - new Date(b.read_timestamp),
  );
  const sequence = ordered
    .map((x) => roles[x.direction_role] || "?")
    .filter((x, i, a) => i === 0 || x !== a[i - 1]);
  const first = sequence.find((x) => x !== "?"),
    last = [...sequence].reverse().find((x) => x !== "?");
  let direction = "UNKNOWN",
    confidence = 0.2;
  if (
    first &&
    last &&
    first !== last &&
    portal?.from_location_id &&
    portal?.to_location_id
  ) {
    direction = first === "A" ? "ENTERING" : "EXITING";
    confidence = sequence.length >= 3 ? 0.9 : 0.8;
  }
  return {
    direction,
    confidence,
    evidence: {
      antennaSequence: sequence,
      timeSpanMs: ordered.length
        ? new Date(ordered.at(-1).read_timestamp) -
          new Date(ordered[0].read_timestamp)
        : 0,
      contributors:
        direction === "UNKNOWN"
          ? ["insufficient ordered side evidence"]
          : ["ordered portal-side transition", "portal orientation configured"],
    },
  };
}
class RfidEventProcessor {
  constructor(repo = new FixedAssetRepository(), options = {}) {
    this.repo = repo;
    this.windowSeconds = 10;
    this.maxAttempts = 5;
    this.leaseSeconds = 60;
    this.workerId = require("crypto").randomUUID();
    this.audit = options.audit || require("./auditService").writeAuditEvent;
  }
  async process(limit = 100, context) {
    if (!context || context.system)
      throw require("./rfidProcessingPolicy").fail(
        403,
        "RFID_PROCESSING_FORBIDDEN",
      );
    return this.run(limit, context);
  }
  async processSystem(limit = 100, { signal } = {}) {
    return this.run(limit, { system: true }, signal);
  }
  async run(limit, context, signal) {
    limit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));
    let selected = 0,
      processed = 0,
      failed = 0,
      terminal = 0;
    while (selected < limit && !signal?.aborted) {
      const claim = await this.claim(context);
      if (!claim) break;
      selected++;
      if (claim.terminal) {
        terminal++;
        continue;
      }
      try {
        const done = await this.repo.transaction((tx) =>
          this.processOne(tx, claim.id, claim, context),
        );
        if (done) processed++;
      } catch (error) {
        failed++;
        await this.failClaim(claim, error, context);
      }
    }
    return { selected, processed, failed, terminal };
  }
  async claim(context) {
    return this.repo.transaction(async (tx) => {
      await require("./rfidProcessingPolicy").timeouts(tx);
      await require("./rfidProcessingPolicy").actor(tx, context);
      const read = (
        await tx.query(
          `SELECT * FROM rfid_read_events WHERE ($1::integer IS NULL OR institute_id=$1) AND (
   (processing_status IN ('PENDING','FAILED') AND (processing_next_attempt_at IS NULL OR processing_next_attempt_at<=clock_timestamp())) OR
   (processing_status='PROCESSING' AND (processing_lease_expires_at IS NULL OR processing_lease_expires_at<=clock_timestamp())))
   ORDER BY COALESCE(processing_next_attempt_at,read_timestamp),id FOR UPDATE SKIP LOCKED LIMIT 1`,
          [context.system ? null : context.instituteId],
        )
      ).rows[0];
      if (!read) return null;
      const stale = read.processing_status === "PROCESSING";
      if (stale && read.processing_lease_token)
        await tx.query(
          "UPDATE rfid_processing_attempts SET outcome='LEASE_EXPIRED',finished_at=clock_timestamp(),error_code='LEASE_EXPIRED' WHERE lease_token=$1 AND outcome='CLAIMED'",
          [read.processing_lease_token],
        );
      if (read.processing_attempts >= this.maxAttempts) {
        await tx.query(
          "UPDATE rfid_read_events SET processing_status='DEAD_LETTER',processing_error_code='RETRY_EXHAUSTED',processing_lease_token=NULL,processing_worker_id=NULL,processing_lease_expires_at=NULL WHERE id=$1",
          [read.id],
        );
        await this.auditEvent(tx, read, "RFID_PROCESSING_EXHAUSTED", context, {
          attempts: read.processing_attempts,
        });
        return { id: read.id, terminal: true };
      }
      const token = require("crypto").randomUUID();
      const row = (
        await tx.query(
          `UPDATE rfid_read_events SET processing_status='PROCESSING',processing_attempts=processing_attempts+1,processing_lease_token=$1,processing_worker_id=$2,
   processing_claimed_at=clock_timestamp(),processing_heartbeat_at=clock_timestamp(),processing_lease_expires_at=clock_timestamp()+make_interval(secs=>$3),processing_next_attempt_at=NULL,
   processing_recovery_count=processing_recovery_count+CASE WHEN $4 THEN 1 ELSE 0 END,processing_last_recovered_at=CASE WHEN $4 THEN clock_timestamp() ELSE processing_last_recovered_at END
   WHERE id=$5 RETURNING *`,
          [token, this.workerId, this.leaseSeconds, stale, read.id],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO rfid_processing_attempts(read_event_id,institute_id,attempt_number,lease_token,worker_id,actor_user_id,outcome) VALUES($1,$2,$3,$4,$5,$6,'CLAIMED')",
        [
          row.id,
          row.institute_id,
          row.processing_attempts,
          token,
          this.workerId,
          context.userId || null,
        ],
      );
      await this.auditEvent(
        tx,
        row,
        stale ? "RFID_PROCESSING_RECOVERED" : "RFID_PROCESSING_CLAIMED",
        context,
        { attempt: row.processing_attempts },
      );
      return { id: row.id, token, workerId: this.workerId };
    });
  }
  async processOne(tx, id, claim, context) {
    await require("./rfidProcessingPolicy").timeouts(tx);
    const read = (
      await tx.query(
        "SELECT r.*,pa.direction_role,p.from_location_id portal_from_location_id,p.to_location_id portal_to_location_id FROM rfid_read_events r LEFT JOIN rfid_portal_antennas pa ON pa.portal_id=r.portal_id AND pa.antenna_id=r.antenna_id LEFT JOIN rfid_portals p ON p.id=r.portal_id WHERE r.id=$1 FOR UPDATE OF r",
        [id],
      )
    ).rows[0];
    if (
      !read ||
      read.processing_status !== "PROCESSING" ||
      read.processing_lease_token !== claim?.token ||
      read.processing_worker_id !== claim?.workerId
    )
      return false;
    if (
      !(
        await tx.query("SELECT $1::timestamptz>clock_timestamp() valid", [
          read.processing_lease_expires_at,
        ])
      ).rows[0].valid
    )
      return false;
    if (!context?.system && read.institute_id !== context?.instituteId)
      throw require("./rfidProcessingPolicy").fail(403, "RFID_SCOPE_MISMATCH");
    await require("./rfidProcessingPolicy").actor(tx, context);
    await require("./rfidProcessingPolicy").source(tx, read);
    if (read.business_event_id || read.processed_at)
      throw require("./rfidProcessingPolicy").fail(
        409,
        "RFID_EVIDENCE_REVIEW_REQUIRED",
      );
    await tx.query(
      "UPDATE rfid_read_events SET processing_heartbeat_at=clock_timestamp(),processing_lease_expires_at=clock_timestamp()+make_interval(secs=>$1) WHERE id=$2",
      [this.leaseSeconds, id],
    );
    const business = await this.applyObservation(tx, read);
    await this.auditEvent(tx, read, "RFID_READ_PROCESSED", context, {
      businessEventId: business.id,
      attempt: read.processing_attempts,
    });
    await tx.query(
      "UPDATE rfid_read_events SET processing_status='PROCESSED',business_event_id=$1,processed_at=clock_timestamp(),processing_error=NULL,processing_error_code=NULL,processing_heartbeat_at=clock_timestamp(),processing_lease_token=NULL,processing_worker_id=NULL,processing_lease_expires_at=NULL WHERE id=$2 AND processing_lease_token=$3",
      [business.id, id, claim.token],
    );
    await tx.query(
      "UPDATE rfid_processing_attempts SET outcome='COMPLETED',finished_at=clock_timestamp() WHERE lease_token=$1 AND outcome='CLAIMED'",
      [claim.token],
    );
    return true;
  }
  async failClaim(claim, error, context) {
    const permanent = [
      "RFID_SOURCE_AUTHORITY_CHANGED",
      "RFID_SCOPE_MISMATCH",
      "RFID_IDENTITY_CHANGED",
      "RFID_PROCESSING_FORBIDDEN",
      "RFID_EVIDENCE_REVIEW_REQUIRED",
    ].includes(error.code);
    const category = permanent
      ? error.code
      : [
            "40001",
            "40P01",
            "55P03",
            "57014",
            "57P01",
            "08006",
            "08003",
            "ECONNRESET",
            "ECONNREFUSED",
          ].includes(error.code)
        ? "DATABASE_INTERRUPTION"
        : "PROCESSING_FAILED";
    try {
      return await this.repo.transaction(async (tx) => {
        await require("./rfidProcessingPolicy").timeouts(tx);
        const row = (
          await tx.query(
            "SELECT * FROM rfid_read_events WHERE id=$1 AND processing_status='PROCESSING' AND processing_lease_token=$2 AND processing_worker_id=$3 FOR UPDATE",
            [claim.id, claim.token, claim.workerId],
          )
        ).rows[0];
        if (!row) return false;
        const terminal =
            permanent || row.processing_attempts >= this.maxAttempts,
          status = terminal ? "DEAD_LETTER" : "FAILED";
        await tx.query(
          `UPDATE rfid_read_events SET processing_status=$1,processing_error_code=$2,processing_error=NULL,processing_next_attempt_at=CASE WHEN $3 THEN NULL ELSE clock_timestamp()+make_interval(secs=>LEAST(300,5*power(2,processing_attempts-1))::integer) END,processing_lease_token=NULL,processing_worker_id=NULL,processing_lease_expires_at=NULL WHERE id=$4`,
          [status, category, terminal, row.id],
        );
        await tx.query(
          "UPDATE rfid_processing_attempts SET outcome=$1,error_code=$2,finished_at=clock_timestamp() WHERE lease_token=$3 AND outcome='CLAIMED'",
          [terminal ? "DEAD_LETTER" : "RETRY", category, claim.token],
        );
        await this.auditEvent(tx, row, "RFID_PROCESSING_FAILED", context, {
          category,
          terminal,
          attempt: row.processing_attempts,
        });
        return true;
      });
    } catch (_) {
      return false;
    } // Database unavailable: the durable lease remains reclaimable; never guess commit outcome.
  }
  auditEvent(tx, read, action, context, metadata) {
    return this.audit({
      entityType: "RFID_READ",
      entityId: read.id,
      instituteId: read.institute_id,
      actorUserId: context?.userId || null,
      action,
      metadata,
      client: tx.db,
    });
  }

  async applyObservation(tx, read) {
    // Serialize one EPC/portal aggregation key without globally blocking other tags.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 17))", [
      `${read.institute_id}:${read.epc}:${read.portal_id || "NO_PORTAL"}`,
    ]);
    const nearby = (
      await tx.query(
        `SELECT r.read_timestamp,pa.direction_role FROM rfid_read_events r LEFT JOIN rfid_portal_antennas pa ON pa.portal_id=r.portal_id AND pa.antenna_id=r.antenna_id LEFT JOIN rfid_antennas na ON na.id=r.antenna_id AND na.reader_id=r.reader_id AND na.institute_id=r.institute_id AND na.enabled JOIN rfid_readers rr ON rr.id=r.reader_id AND rr.institute_id=r.institute_id AND rr.is_active JOIN rfid_integration_clients ic ON ic.id=r.integration_client_id AND ic.institute_id=r.institute_id AND ic.enabled AND 'rfid:ingest'=ANY(ic.scopes) WHERE r.institute_id=$1 AND r.epc=$2 AND r.portal_id IS NOT DISTINCT FROM $3 AND r.asset_id IS NOT DISTINCT FROM $6 AND r.asset_tag_id IS NOT DISTINCT FROM $7 AND (r.antenna_id IS NULL OR na.id IS NOT NULL) AND (r.portal_id IS NULL OR pa.portal_id IS NOT NULL) AND (rr.location_id IS NULL OR EXISTS(SELECT 1 FROM asset_locations l WHERE l.id=rr.location_id AND l.institute_id=r.institute_id AND l.is_active)) AND (na.location_id IS NULL OR EXISTS(SELECT 1 FROM asset_locations l WHERE l.id=na.location_id AND l.institute_id=r.institute_id AND l.is_active)) AND r.read_timestamp BETWEEN $4::timestamptz-make_interval(secs=>$5) AND $4::timestamptz+make_interval(secs=>$5) ORDER BY r.read_timestamp,r.id`,
        [
          read.institute_id,
          read.epc,
          read.portal_id,
          read.read_timestamp,
          this.windowSeconds,
          read.asset_id,
          read.asset_tag_id,
        ],
      )
    ).rows;
    const portal = read.portal_id
        ? {
            from_location_id: read.portal_from_location_id,
            to_location_id: read.portal_to_location_id,
          }
        : null,
      { direction, confidence, evidence } = deriveDirection(nearby, portal);
    let eventType = read.asset_id ? "ASSET_SEEN" : "UNKNOWN_TAG",
      auth = "NOT_APPLICABLE",
      movement = null,
      derivedFrom = null,
      derivedTo = null;
    if (read.asset_id && read.portal_id && direction !== "UNKNOWN") {
      derivedFrom =
        direction === "ENTERING"
          ? portal.from_location_id
          : portal.to_location_id;
      derivedTo =
        direction === "ENTERING"
          ? portal.to_location_id
          : portal.from_location_id;
      const matches = (
        await tx.query(
          "SELECT id FROM asset_movements WHERE institute_id=$1 AND asset_id=$2 AND status IN ('APPROVED','IN_TRANSIT') AND from_location_id IS NOT DISTINCT FROM $3 AND to_location_id IS NOT DISTINCT FROM $4 AND requested_at BETWEEN $5::timestamptz-interval '24 hours' AND $5::timestamptz+interval '24 hours'",
          [
            read.institute_id,
            read.asset_id,
            derivedFrom,
            derivedTo,
            read.read_timestamp,
          ],
        )
      ).rows;
      if (matches.length === 1) {
        auth = "AUTHORIZED";
        eventType = "AUTHORIZED_MOVEMENT";
        movement = matches[0].id;
      } else if (matches.length === 0) {
        auth = "UNAUTHORIZED";
        eventType = "UNAUTHORIZED_MOVEMENT";
      } else {
        auth = "UNKNOWN";
        evidence.authorization = "multiple matching movements";
      }
    }
    // Require recent activity and a bounded session start so neighboring reads cannot chain forever.
    const existing = (
      await tx.query(
        `SELECT * FROM rfid_business_events WHERE institute_id=$1 AND epc=$2 AND portal_id IS NOT DISTINCT FROM $3 AND asset_id IS NOT DISTINCT FROM $6 AND asset_tag_id IS NOT DISTINCT FROM $7 AND EXISTS(SELECT 1 FROM rfid_readers er WHERE er.id=rfid_business_events.reader_id AND er.institute_id=rfid_business_events.institute_id) AND last_seen_at >= $4::timestamptz-make_interval(secs=>$5) AND first_seen_at >= $4::timestamptz-make_interval(secs=>$5) AND first_seen_at <= $4::timestamptz ORDER BY last_seen_at DESC LIMIT 2 FOR UPDATE`,
        [
          read.institute_id,
          read.epc,
          read.portal_id,
          read.read_timestamp,
          this.windowSeconds,
          read.asset_id,
          read.asset_tag_id,
        ],
      )
    ).rows;
    if (existing.length > 1)
      throw new Error("Ambiguous RFID aggregation state");
    let business = existing[0];
    if (business)
      business = (
        await tx.query(
          "UPDATE rfid_business_events SET first_seen_at=LEAST(first_seen_at,$1),last_seen_at=GREATEST(last_seen_at,$1),observation_count=observation_count+1,event_type=$2,direction=$3,confidence_score=$4,authorization_status=$5,related_asset_movement_id=$6,from_location_id=$7,to_location_id=$8,metadata=$9 WHERE id=$10 RETURNING *",
          [
            read.read_timestamp,
            eventType,
            direction,
            confidence,
            auth,
            movement,
            derivedFrom,
            derivedTo,
            { evidence },
            business.id,
          ],
        )
      ).rows[0];
    else
      business = (
        await tx.query(
          `INSERT INTO rfid_business_events(institute_id,event_type,asset_id,asset_tag_id,epc,portal_id,reader_id,from_location_id,to_location_id,direction,first_seen_at,last_seen_at,observation_count,confidence_score,authorization_status,related_asset_movement_id,status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12,$13,$14,'OPEN',$15) RETURNING *`,
          [
            read.institute_id,
            eventType,
            read.asset_id,
            read.asset_tag_id,
            read.epc,
            read.portal_id,
            read.reader_id,
            derivedFrom,
            derivedTo,
            direction,
            read.read_timestamp,
            confidence,
            auth,
            movement,
            { evidence },
          ],
        )
      ).rows[0];
    if (["UNKNOWN_TAG", "UNAUTHORIZED_MOVEMENT"].includes(eventType))
      await tx.query(
        `INSERT INTO asset_exceptions(institute_id,asset_id,asset_tag_id,rfid_business_event_id,exception_type,severity,status,detected_at) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7) ON CONFLICT(rfid_business_event_id,exception_type) DO NOTHING`,
        [
          read.institute_id,
          read.asset_id,
          read.asset_tag_id,
          business.id,
          eventType,
          eventType === "UNAUTHORIZED_MOVEMENT" ? "HIGH" : "MEDIUM",
          read.read_timestamp,
        ],
      );
    return business;
  }
}
module.exports = RfidEventProcessor;
module.exports.deriveDirection = deriveDirection;
