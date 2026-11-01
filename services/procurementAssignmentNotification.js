"use strict";
const { createAssignmentPolicy } = require("./procurementAssignmentPolicy");
const { sendEmail } = require("../utils/emailService");
// Invoked only by the committed outbox worker, never inside an approval command.
// Revalidate recipient and request ownership before disclosing request metadata.
async function deliverAssignmentNotification(client, event) {
  const payload = event.payload || {};
  const request = (
    await client.query("SELECT * FROM requests WHERE id=$1 FOR SHARE", [
      payload.requestId,
    ])
  ).rows[0];
  if (
    !request ||
    request.institute_id == null ||
    Number(request.institute_id) !== Number(payload.instituteId)
  )
    return;
  if (
    [
      "rejected",
      "cancelled",
      "canceled",
      "closed",
      "completed",
      "received",
      "available in stock",
    ].includes(
      String(request.status || "")
        .trim()
        .toLowerCase(),
    )
  )
    return;
  let user;
  try {
    user = await createAssignmentPolicy().assignee(
      event.recipient_user_id,
      request.institute_id,
      client,
    );
  } catch (e) {
    if ([400, 404].includes(e.statusCode)) return;
    throw e;
  }
  const assigned = (
    await client.query(
      "SELECT id FROM requested_items WHERE request_id=$1 AND assigned_to=$2 LIMIT 1",
      [request.id, user.id],
    )
  ).rows.length;
  if (Number(request.assigned_to) !== Number(user.id) && !assigned) return;
  const inserted = await client.query(
    `INSERT INTO notifications(user_id,title,message,link,metadata,outbox_event_id) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(outbox_event_id) DO NOTHING RETURNING id`,
    [
      user.id,
      payload.title,
      payload.message,
      payload.link,
      JSON.stringify(payload),
      event.id,
    ],
  );
  if (!inserted.rows.length) return;
  if (user.email)
    await sendEmail(
      user.email,
      payload.title,
      `Hello ${user.name},\n\n${payload.message}\nPlease log in to the procurement portal to review and take action.`,
    );
}
module.exports = { deliverAssignmentNotification };
