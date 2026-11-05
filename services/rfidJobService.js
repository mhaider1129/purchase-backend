"use strict";
const Repository = require("../repositories/fixedAssetRepository");
const { actor, source, fail, timeouts } = require("./rfidProcessingPolicy");
const { writeAuditEvent } = require("./auditService");
const states = [
  "PENDING",
  "PROCESSING",
  "FAILED",
  "DEAD_LETTER",
  "PROCESSED",
  "IGNORED",
];
class RfidJobService {
  constructor(repo = new Repository(), audit = writeAuditEvent) {
    this.repo = repo;
    this.audit = audit;
  }
  async list(query, context) {
    return this.repo.transaction(async (tx) => {
      await timeouts(tx);
      await actor(tx, context);
      if (query.status && !states.includes(query.status))
        throw fail(400, "RFID_INVALID_JOB_STATUS");
      const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25)),
        page = Math.max(1, parseInt(query.page, 10) || 1),
        params = [context.instituteId, query.status || null];
      const where =
        "institute_id=$1 AND ($2::text IS NULL OR processing_status=$2)";
      const total = (
        await tx.query(
          `SELECT count(*)::integer total FROM rfid_read_events WHERE ${where}`,
          params,
        )
      ).rows[0].total;
      const data = (
        await tx.query(
          `SELECT id,institute_id,integration_client_id,reader_id,asset_id,read_timestamp,processing_status,processing_attempts,processing_claimed_at,processing_heartbeat_at,processing_lease_expires_at,processing_next_attempt_at,processing_error_code,processing_recovery_count,processing_last_recovered_at,processed_at,
   CASE WHEN processing_status='PROCESSING' AND (processing_lease_expires_at IS NULL OR processing_lease_expires_at<=clock_timestamp()) THEN 'LEASE_EXPIRED' WHEN processing_recovery_count>0 THEN 'RECOVERED' ELSE 'NOT_RECOVERED' END recovery_status
   FROM rfid_read_events WHERE ${where} ORDER BY read_timestamp DESC,id DESC LIMIT $3 OFFSET $4`,
          [...params, limit, (page - 1) * limit],
        )
      ).rows;
      return {
        data,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    });
  }
  async attempts(id, context) {
    return this.repo.transaction(async (tx) => {
      await timeouts(tx);
      await actor(tx, context);
      if (
        !(
          await tx.query(
            "SELECT id FROM rfid_read_events WHERE id=$1 AND institute_id=$2",
            [id, context.instituteId],
          )
        ).rowCount
      )
        throw fail(404, "RFID_JOB_NOT_FOUND");
      return (
        await tx.query(
          "SELECT attempt_number,claimed_at,finished_at,outcome,error_code,actor_user_id FROM rfid_processing_attempts WHERE read_event_id=$1 AND institute_id=$2 ORDER BY attempt_number",
          [id, context.instituteId],
        )
      ).rows;
    });
  }
  async recover(id, reason, context) {
    if (
      typeof reason !== "string" ||
      reason.trim().length < 3 ||
      reason.length > 500
    )
      throw fail(400, "RFID_RECOVERY_REASON_REQUIRED");
    return this.repo.transaction(async (tx) => {
      await timeouts(tx);
      await actor(tx, context);
      const read = (
        await tx.query(
          "SELECT * FROM rfid_read_events WHERE id=$1 AND institute_id=$2 FOR UPDATE",
          [id, context.instituteId],
        )
      ).rows[0];
      if (!read) throw fail(404, "RFID_JOB_NOT_FOUND");
      await source(tx, read);
      if (read.processing_status === "PENDING")
        return { id: read.id, status: "PENDING", changed: false };
      if (
        read.processing_attempts >= 5 ||
        ["PROCESSED", "IGNORED", "DEAD_LETTER"].includes(
          read.processing_status,
        ) ||
        read.business_event_id ||
        read.processed_at
      )
        throw fail(409, "RFID_RECOVERY_REQUIRES_REVIEW");
      if (
        read.processing_status === "PROCESSING" &&
        read.processing_lease_expires_at &&
        (
          await tx.query("SELECT $1::timestamptz>clock_timestamp() active", [
            read.processing_lease_expires_at,
          ])
        ).rows[0].active
      )
        throw fail(409, "RFID_LEASE_ACTIVE");
      if (read.processing_lease_token)
        await tx.query(
          "UPDATE rfid_processing_attempts SET outcome='LEASE_EXPIRED',finished_at=clock_timestamp(),error_code='MANUAL_RECOVERY' WHERE lease_token=$1 AND outcome='CLAIMED'",
          [read.processing_lease_token],
        );
      await tx.query(
        "UPDATE rfid_read_events SET processing_status='PENDING',processing_next_attempt_at=NULL,processing_lease_token=NULL,processing_worker_id=NULL,processing_lease_expires_at=NULL,processing_recovery_count=processing_recovery_count+1,processing_last_recovered_at=clock_timestamp() WHERE id=$1",
        [read.id],
      );
      await this.audit({
        entityType: "RFID_READ",
        entityId: read.id,
        action: "RFID_PROCESSING_MANUAL_RECOVERY",
        actorUserId: context.userId,
        instituteId: context.instituteId,
        reason: reason.trim(),
        metadata: { attempts: read.processing_attempts },
        client: tx.db,
      });
      return { id: read.id, status: "PENDING", changed: true };
    });
  }
}
module.exports = RfidJobService;
