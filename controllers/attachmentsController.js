"use strict";
const pool = require("../config/db");
const {
  createAttachmentAuthorization,
  denied,
} = require("../services/attachmentAuthorizationService");
const access = createAttachmentAuthorization();
const adapter = require("../services/attachmentStorageAdapter");
const { serializeAttachment } = require("../utils/attachmentPaths");
const { insertAttachment } = require("../utils/attachmentSchema");
const { storeAttachmentFile } = require("../utils/attachmentStorage");
const { getUploadedFile } = require("../utils/uploadedFile");
const { writeAuditEvent } = require("../services/auditService");
const noCache = (res) => res.set("Cache-Control", "private, no-store");
async function transaction(work) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const value = await work(db);
    await db.query("COMMIT");
    return value;
  } catch (e) {
    await db.query("ROLLBACK");
    if (e.code === "23503")
      throw Object.assign(
        new Error(
          "File is retained as business evidence. Upload a revision instead.",
        ),
        { statusCode: 409 },
      );
    throw e;
  } finally {
    db.release();
  }
}
function wrap(fn) {
  return (req, res, next) => {
    noCache(res);
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}
async function resolve(req, db = pool, action = "read") {
  const actor = await access.actor(req.user, db);
  const file = await access.attachment(
    actor,
    req.params.id || req.params.fileId,
    action,
    db,
  );
  if (
    req.params.contractId &&
    String(file.contract_id) !== String(req.params.contractId)
  )
    throw denied();
  return { actor, file };
}
const download = wrap(async (req, res, next) => {
  const { file } = await resolve(req);
  return adapter.download(file, req, res, next);
});
const metadata = wrap(async (req, res) => {
  const { file } = await resolve(req);
  res.json(serializeAttachment(file));
});
const list = (spec) =>
  wrap(async (req, res) => {
    const actor = await access.actor(req.user);
    const parent = spec(req);
    await access.parent(actor, parent);
    const column = parent.contractId
      ? "contract_id"
      : parent.itemId
        ? "item_id"
        : "request_id";
    const id = parent.contractId || parent.itemId || parent.requestId;
    const rows = (
      await pool.query(
        `SELECT * FROM attachments WHERE ${column}=$1 ORDER BY id`,
        [id],
      )
    ).rows;
    const visible = [];
    for (const row of rows) {
      try {
        await access.attachment(actor, row.id);
        visible.push(serializeAttachment(row));
      } catch (e) {
        if (e.statusCode !== 404) throw e;
      }
    }
    res.json(visible);
  });
const upload = (spec) =>
  wrap(async (req, res) => {
    const parent = spec(req),
      file = getUploadedFile(req);
    if (!file)
      throw Object.assign(new Error("No file uploaded"), { statusCode: 400 });
    let stored;
    try {
      const saved = await transaction(async (db) => {
        let actor = await access.actor(req.user, db);
        let root = await access.parent(actor, parent, "upload", db);
        const requestId = parent.contractId
          ? null
          : parent.requestId || root.id;
        stored = await storeAttachmentFile({
          file,
          requestId,
          itemId: parent.itemId || null,
          contractId: parent.contractId || null,
        });
        // Lock business ownership before the final check/publication; storage has
        // already finished, so assignment edits are not blocked during upload.
        if (parent.contractId)
          await db.query("SELECT id FROM contracts WHERE id=$1 FOR SHARE", [
            parent.contractId,
          ]);
        else
          await db.query("SELECT id FROM requests WHERE id=$1 FOR SHARE", [
            requestId,
          ]);
        // Multipart/storage may take time. Recheck current authority and relationships before publication.
        actor = await access.actor(req.user, db);
        root = await access.parent(actor, parent, "upload", db);
        const inserted = await insertAttachment(db, {
          requestId,
          itemId: parent.itemId || null,
          contractId: parent.contractId || null,
          fileName: file.originalname,
          filePath: stored.objectKey,
          uploadedBy: actor.id,
        });
        await writeAuditEvent({
          client: db,
          entityType: "attachment",
          entityId: inserted.rows[0].id,
          action: "ATTACHMENT_UPLOADED",
          actorUserId: actor.id,
          requestId,
          instituteId: actor.institute_id,
        });
        return inserted.rows[0];
      });
      res.status(201).json({
        message: "File uploaded successfully",
        attachmentId: saved.id,
      });
    } catch (e) {
      if (stored) await adapter.remove(stored.objectKey).catch(() => {});
      throw e;
    }
  });
async function retained(db, file) {
  if (file.request_id) {
    const signed = (
      await db.query(
        "SELECT id FROM approvals WHERE request_id=$1 AND status IN ('Approved','Rejected') AND NOT COALESCE(is_superseded,false) LIMIT 1",
        [file.request_id],
      )
    ).rows;
    if (signed.length)
      throw Object.assign(
        new Error(
          "File is retained as approval evidence. Upload a revision instead.",
        ),
        { statusCode: 409 },
      );
  }
  if (
    file.contract_id &&
    (
      await access.optional(
        db,
        "contract_approvals",
        "SELECT id FROM contract_approvals WHERE contract_id=$1 AND status IN ('Approved','Rejected') LIMIT 1",
        [file.contract_id],
      )
    ).length
  )
    throw Object.assign(
      new Error(
        "File is retained as contract approval evidence. Upload a revision instead.",
      ),
      { statusCode: 409 },
    );
  if (
    (
      await access.optional(
        db,
        "contract_document_versions",
        "SELECT id FROM contract_document_versions WHERE (to_jsonb(contract_document_versions)->>'storage_path')=$1 OR (to_jsonb(contract_document_versions)->>'file_url')=$2 LIMIT 1",
        [file.file_path, "/attachments/" + file.id + "/download"],
      )
    ).length
  )
    throw Object.assign(
      new Error(
        "File is retained as a document version. Upload a revision instead.",
      ),
      { statusCode: 409 },
    );
  for (const [table, sql] of [
    [
      "technical_evidence_references",
      "SELECT id FROM technical_evidence_references WHERE attachment_id=$1 LIMIT 1",
    ],
    [
      "preprocurement_technical_reviews",
      `SELECT id FROM preprocurement_technical_reviews WHERE jsonb_path_exists(item_packets,'$[*].evidence.attachment_ids[*] ? (@ == $id || @ == $text)',jsonb_build_object('id',$1::integer,'text',$1::text)) LIMIT 1`,
    ],
    [
      "device_demo_events",
      "SELECT id FROM device_demo_events WHERE attachment_ids @> jsonb_build_array($1::integer) OR attachment_ids @> jsonb_build_array($1::text) LIMIT 1",
    ],
    [
      "contract_required_documents",
      "SELECT id FROM contract_required_documents WHERE attachment_id=$1 LIMIT 1",
    ],
    [
      "contract_obligations",
      "SELECT id FROM contract_obligations WHERE (to_jsonb(contract_obligations)->>'proof_attachment_id')=$1::text LIMIT 1",
    ],
    [
      "contract_documents",
      "SELECT id FROM contract_documents WHERE (to_jsonb(contract_documents)->>'attachment_id')=$1::text LIMIT 1",
    ],
  ]) {
    if ((await access.optional(db, table, sql, [file.id])).length)
      throw Object.assign(
        new Error(
          "File is retained as business evidence. Upload a revision instead.",
        ),
        { statusCode: 409 },
      );
  }
}
const remove = wrap(async (req, res) => {
  const file = await transaction(async (db) => {
    const normalized = {
      ...req,
      params: {
        ...req.params,
        id: req.params.id || req.params.fileId || req.params.attachmentId,
      },
    };
    const first = await resolve(normalized, db, "delete");
    // Parent before file, matching the approval-decision lock order.
    if (first.file.request_id)
      await db.query("SELECT id FROM requests WHERE id=$1 FOR UPDATE", [
        first.file.request_id,
      ]);
    if (first.file.contract_id)
      await db.query("SELECT id FROM contracts WHERE id=$1 FOR UPDATE", [
        first.file.contract_id,
      ]);
    await db.query("SELECT id FROM attachments WHERE id=$1 FOR UPDATE", [
      first.file.id,
    ]);
    const { actor, file } = await resolve(normalized, db, "delete");
    await retained(db, file);
    await db.query("DELETE FROM attachments WHERE id=$1", [file.id]);
    await writeAuditEvent({
      client: db,
      entityType: "attachment",
      entityId: file.id,
      action: "ATTACHMENT_DELETED",
      actorUserId: actor.id,
      instituteId: actor.institute_id,
      requestId: file.request_id,
      beforeData: file,
      metadata: { file_name: file.file_name },
    });
    return file;
  });
  // Never destroy a blob still referenced by a second metadata record.
  const shared = (
    await pool.query("SELECT id FROM attachments WHERE file_path=$1 LIMIT 1", [
      file.file_path,
    ])
  ).rows;
  if (!shared.length)
    await adapter
      .remove(file.file_path)
      .catch(() => console.warn("Attachment storage cleanup deferred"));
  res.json({ success: true, message: "File deleted successfully" });
});
const pathDownload = wrap(async (req, res, next) => {
  let supplied = req.query.path || req.params.filename || req.path;
  if (typeof supplied !== "string") throw denied();
  if (!req.query.path && !req.params.filename) {
    try {
      supplied = decodeURIComponent(supplied);
    } catch {
      throw denied();
    }
  }
  if (/%(?:2e|2f|5c|00)/i.test(supplied)) throw denied();
  supplied = supplied.replace(/^\//, "");
  adapter.key(supplied);
  const candidates = (
    await pool.query(
      "SELECT id FROM attachments WHERE file_path=$1 OR file_path=$2",
      [supplied, "uploads/" + supplied],
    )
  ).rows;
  if (!candidates.length && supplied.includes("/")) {
    const plans = (
      await pool.query(
        "SELECT id FROM procurement_plans WHERE file_path=$1 OR file_path=$2",
        [supplied, "uploads/" + supplied],
      )
    ).rows;
    if (plans.length === 1) {
      const a = await access.actor(req.user);
      const plan = await access.plan(a, plans[0].id);
      return adapter.download(plan, req, res, next);
    }
    if (plans.length > 1) throw denied();
  }
  // Filename compatibility is only safe for a unique registered object.
  if (!candidates.length && !supplied.includes("/"))
    candidates.push(
      ...(
        await pool.query(
          "SELECT id FROM attachments WHERE regexp_replace(file_path,'^.*/','')=$1 LIMIT 2",
          [supplied],
        )
      ).rows,
    );
  if (candidates.length !== 1) throw denied();
  req.params.id = candidates[0].id;
  return download(req, res, next);
});
module.exports = {
  download,
  metadata,
  remove,
  pathDownload,
  retained,
  listRequest: list((req) => ({ requestId: req.params.requestId })),
  listItem: list((req) => ({ itemId: req.params.itemId })),
  listContract: list((req) => ({ contractId: req.params.contractId })),
  uploadRequest: upload((req) => ({ requestId: req.params.requestId })),
  uploadItem: upload((req) => ({ itemId: req.params.itemId })),
  uploadContract: upload((req) => ({ contractId: req.params.contractId })),
};
