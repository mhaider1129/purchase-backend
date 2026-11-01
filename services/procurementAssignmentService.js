"use strict";
const pool = require("../config/db");
const withTransaction = require("../utils/withTransaction");
const {
  createAssignmentPolicy,
  error,
  id,
} = require("./procurementAssignmentPolicy");
const { writeAuditEvent } = require("./auditService");
const { enqueueNotification } = require("./notificationOutboxService");
const {
  synchronizeCaseAssignments,
} = require("./procurementPerformance/procurementCaseService");
const {
  createProcurementPerformanceRepository,
} = require("../repositories/procurementPerformanceRepository");
const policy = createAssignmentPolicy();
const same = (a, b) => Number(a || 0) === Number(b || 0);
async function schema(client) {
  const check =
    await client.query(`SELECT count(*)=4 AS assignment_columns_available FROM information_schema.columns
    WHERE table_schema='public' AND table_name='requested_items' AND column_name IN ('assigned_to','assigned_by','assigned_at','assignment_notes')`);
  if (check.rows[0]?.assignment_columns_available !== true)
    throw error(
      503,
      "Apply manual SQL 057 assignment prerequisites",
      "ASSIGNMENT_SCOPE_SCHEMA_REQUIRED",
    );
}
async function assign(command, suppliedClient = null) {
  if (!["manual", "split", "automatic"].includes(command.method))
    throw error(400, "Unsupported assignment method");
  const requestId = id(command.requestId);
  const automatic = command.method === "automatic";
  if (automatic && (!suppliedClient?.query || suppliedClient === pool))
    throw new TypeError("Approval transaction client is required");
  return withTransaction(
    async (client) => {
      const actor = await policy.actor(command.actor, client, !automatic);
      const request = await policy.request(actor, requestId, client);
      await policy.approved(request, client);
      if (automatic) await policy.automaticAuthority(actor, request, client);
      if (command.expectedAssigneeId != null) id(command.expectedAssigneeId);
      if (
        command.expectedAssigneeId !== undefined &&
        !same(request.assigned_to, command.expectedAssigneeId)
      )
        throw error(
          409,
          "Assignment changed; reload before retrying",
          "ASSIGNMENT_STALE",
        );
      let rule = null;
      let assignments = command.assignments;
      if (automatic) {
        rule =
          await require("./requestAutoAssignmentService").fetchAutoAssignmentRuleForRequest(
            client,
            request,
          );
        if (!rule) return null;
        assignments = [{ user_id: rule.assignee_user_id }];
      }
      await schema(client);
      const items = (
        await client.query(
          "SELECT * FROM requested_items WHERE request_id=$1 ORDER BY id FOR UPDATE",
          [requestId],
        )
      ).rows;
      const eligible = items.filter(
        (item) =>
          String(item.approval_status || "")
            .trim()
            .toLowerCase() !== "rejected",
      );
      if (!Array.isArray(assignments) || !assignments.length)
        throw error(400, "At least one procurement assignment is required");
      const split = command.method === "split";
      assignments = assignments.map((a) => {
        if (!a || typeof a !== "object")
          throw error(400, "Invalid assignment entry");
        return {
          user_id: id(a.user_id),
          requested_item_ids: split ? a.requested_item_ids : undefined,
          notes:
            split && typeof a.notes === "string"
              ? a.notes.trim() || null
              : null,
        };
      });
      const users = new Map();
      for (const userId of [
        ...new Set(assignments.map((a) => id(a.user_id))),
      ].sort((a, b) => a - b)) {
        try {
          users.set(
            userId,
            await policy.assignee(userId, request.institute_id, client),
          );
        } catch (e) {
          if (automatic && [400, 404].includes(e.statusCode))
            return { ...rule, skipped: true, reason: "ineligible_assignee" };
          throw e;
        }
      }
      const owners = new Map(),
        notes = new Map(),
        seen = new Set();
      for (const assignment of assignments) {
        const selected = split
          ? assignment.requested_item_ids
          : eligible.map((item) => item.id);
        if (!Array.isArray(selected) || (split && !selected.length))
          throw error(400, "Assignment item IDs must be a non-empty array");
        for (const value of selected) {
          const itemId = id(value);
          if (seen.has(itemId))
            throw error(400, `Item ${itemId} is assigned more than once`);
          seen.add(itemId);
          if (!eligible.some((item) => Number(item.id) === itemId))
            throw error(
              400,
              "Assignment item does not belong to this request or is rejected",
            );
          owners.set(itemId, id(assignment.user_id));
          notes.set(
            itemId,
            split && typeof assignment.notes === "string"
              ? assignment.notes.trim() || null
              : null,
          );
        }
      }
      if (command.expectedItemAssignees !== undefined) {
        const expected = command.expectedItemAssignees;
        if (
          !expected ||
          typeof expected !== "object" ||
          Array.isArray(expected)
        )
          throw error(400, "Expected item assignees must be a map");
        for (const item of eligible.filter((i) => owners.has(Number(i.id)))) {
          if (!Object.hasOwn(expected, String(item.id)))
            throw error(400, "Expected assignee missing for selected item");
          if (expected[item.id] != null) id(expected[item.id]);
          if (!same(item.assigned_to, expected[item.id]))
            throw error(
              409,
              "Item assignment changed; reload before retrying",
              "ASSIGNMENT_STALE",
            );
        }
      }
      const currentOwners = new Set(
        eligible.map(
          (item) => owners.get(Number(item.id)) ?? item.assigned_to ?? null,
        ),
      );
      const assignedTo = split
        ? currentOwners.size === 1 && !currentOwners.has(null)
          ? [...currentOwners][0]
          : null
        : id(assignments[0].user_id);
      const changedItems = eligible.filter(
        (item) =>
          owners.has(Number(item.id)) &&
          (!same(item.assigned_to, owners.get(Number(item.id))) ||
            (item.assignment_notes || null) !== notes.get(Number(item.id))),
      );
      const caseAvailable = (
        await client.query(
          "SELECT to_regclass('public.procurement_cases') IS NOT NULL AS available",
        )
      ).rows[0]?.available;
      const caseChanges = caseAvailable
        ? await synchronizeCaseAssignments({
            repository: createProcurementPerformanceRepository(client),
            request,
            owners,
            actorId: actor.id,
          })
        : [];
      const base = {
        request_id: requestId,
        id: requestId,
        request_type: request.request_type,
        assigned_to: assignedTo,
        assigned_user: users.get(Number(assignedTo))?.name,
        assignments: assignments.map((a) => ({
          ...a,
          assigned_user: users.get(Number(a.user_id))?.name,
        })),
      };
      if (
        same(request.assigned_to, assignedTo) &&
        !changedItems.length &&
        !caseChanges.length
      )
        return {
          ...rule,
          ...base,
          changed: false,
          skipped: true,
          reason: "already_assigned",
        };
      for (const item of changedItems)
        await client.query(
          "UPDATE requested_items SET assigned_to=$1,assigned_by=$2,assigned_at=NOW(),assignment_notes=$3 WHERE id=$4 AND request_id=$5",
          [
            owners.get(Number(item.id)),
            actor.id,
            notes.get(Number(item.id)),
            item.id,
            requestId,
          ],
        );
      const updated = (
        await client.query(
          "UPDATE requests SET assigned_to=$1,updated_at=NOW() WHERE id=$2 RETURNING id,request_type,assigned_to",
          [assignedTo, requestId],
        )
      ).rows[0];
      const method = automatic
        ? request.assigned_to
          ? "automatic_reassignment"
          : "automatic"
        : split
          ? "split"
          : request.assigned_to
            ? "reassignment"
            : "manual";
      const action = automatic
        ? "Auto-assigned to procurement"
        : split
          ? "split_assigned_to_procurement"
          : request.assigned_to
            ? "reassigned_to_procurement"
            : "assigned_to_procurement";
      const reason =
        typeof command.reason === "string" ? command.reason.trim() : null;
      const log = (
        await client.query(
          "INSERT INTO request_logs(request_id,action,actor_id,comments) VALUES($1,$2,$3,$4) RETURNING id",
          [
            requestId,
            action,
            actor.id,
            JSON.stringify({
              method,
              previousAssignee: request.assigned_to,
              newAssignee: assignedTo,
              assignments: base.assignments,
              ruleId: rule?.id,
              reason,
            }),
          ],
        )
      ).rows[0];
      if (!log?.id) throw new Error("Assignment history was not persisted");
      await writeAuditEvent({
        client,
        entityType: "request",
        entityId: requestId,
        requestId,
        instituteId: request.institute_id,
        actorUserId: actor.id,
        action: "PROCUREMENT_ASSIGNMENT_CHANGED",
        reason,
        beforeData: {
          assigned_to: request.assigned_to,
          items: eligible.map(({ id, assigned_to, assignment_notes }) => ({
            id,
            assigned_to,
            assignment_notes,
          })),
        },
        afterData: {
          ...base,
          items: eligible.map((item) => ({
            id: item.id,
            assigned_to: owners.get(Number(item.id)) ?? item.assigned_to,
            assignment_notes: owners.has(Number(item.id))
              ? notes.get(Number(item.id))
              : item.assignment_notes,
          })),
        },
        metadata: {
          method,
          ruleId: rule?.id || null,
          caseChanges: caseChanges.map((c) => ({
            caseId: c.before.id,
            previousBuyer: c.before.assigned_buyer_id,
            newBuyer: c.after.assigned_buyer_id,
          })),
          logId: log.id,
        },
      });
      const recipients = new Set(
        changedItems.map((item) => owners.get(Number(item.id))),
      );
      if (!same(request.assigned_to, assignedTo) && assignedTo)
        recipients.add(Number(assignedTo));
      for (const userId of recipients)
        await enqueueNotification(client, {
          type: "PROCUREMENT_ASSIGNMENT_CHANGED",
          entityType: "request",
          entityId: requestId,
          userId,
          idempotencyKey: `procurement-assignment:${requestId}:log:${log.id}:user:${userId}`,
          payload: {
            instituteId: request.institute_id,
            requestId,
            requestType: request.request_type,
            method,
            actorId: actor.id,
            logId: log.id,
            title: split
              ? "New split procurement assignment"
              : "New procurement assignment",
            message: `You have been assigned ${split ? "part of" : "to"} the ${request.request_type} request with ID ${requestId}.`,
            link: `/requests/${requestId}`,
          },
        });
      return { ...rule, ...base, changed: true, assigned_request: updated };
    },
    { client: suppliedClient },
  );
}
module.exports = { assign, schema };
