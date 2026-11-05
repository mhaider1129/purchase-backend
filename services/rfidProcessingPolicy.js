"use strict";
const { getPermissionsForUserId } = require("../utils/permissionService");
const fail = (statusCode, code) =>
  Object.assign(new Error(code), { statusCode, code });
async function actor(tx, context) {
  if (context?.system === true) return;
  if (
    !Number.isInteger(context?.userId) ||
    !Number.isInteger(context?.instituteId)
  )
    throw fail(403, "RFID_PROCESSING_FORBIDDEN");
  const user = (
    await tx.query(
      "SELECT id,institute_id,is_active FROM users WHERE id=$1 FOR SHARE",
      [context.userId],
    )
  ).rows[0];
  if (!user?.is_active || user.institute_id !== context.instituteId)
    throw fail(403, "RFID_PROCESSING_FORBIDDEN");
  const permissions = await getPermissionsForUserId(user.id, tx.db || tx);
  if (!permissions.permissions.includes("rfid.manage-infrastructure"))
    throw fail(403, "RFID_PROCESSING_FORBIDDEN");
}
async function source(tx, read) {
  const client = (
    await tx.query(
      "SELECT id FROM rfid_integration_clients WHERE id=$1 AND institute_id=$2 AND enabled AND 'rfid:ingest'=ANY(scopes) FOR SHARE",
      [read.integration_client_id, read.institute_id],
    )
  ).rows[0];
  if (!client) throw fail(403, "RFID_SOURCE_AUTHORITY_CHANGED");
  const reader = (
    await tx.query(
      "SELECT * FROM rfid_readers WHERE id=$1 AND institute_id=$2 AND is_active FOR SHARE",
      [read.reader_id, read.institute_id],
    )
  ).rows[0];
  if (!reader) throw fail(403, "RFID_SCOPE_MISMATCH");
  const locations = [reader.location_id];
  if (read.antenna_id != null) {
    const antenna = (
      await tx.query(
        "SELECT * FROM rfid_antennas WHERE id=$1 AND reader_id=$2 AND institute_id=$3 AND enabled FOR SHARE",
        [read.antenna_id, read.reader_id, read.institute_id],
      )
    ).rows[0];
    if (!antenna) throw fail(403, "RFID_SCOPE_MISMATCH");
    locations.push(antenna.location_id);
  }
  if (read.portal_id != null) {
    const portal = (
      await tx.query(
        "SELECT p.* FROM rfid_portals p JOIN rfid_portal_antennas pa ON pa.portal_id=p.id WHERE p.id=$1 AND pa.antenna_id=$2 AND p.institute_id=$3 AND p.enabled FOR SHARE OF p,pa",
        [read.portal_id, read.antenna_id, read.institute_id],
      )
    ).rows[0];
    if (!portal) throw fail(403, "RFID_SCOPE_MISMATCH");
    locations.push(
      portal.location_id,
      portal.from_location_id,
      portal.to_location_id,
    );
  }
  for (const id of new Set(locations.filter((id) => id != null))) {
    if (
      !(
        await tx.query(
          "SELECT id FROM asset_locations WHERE id=$1 AND institute_id=$2 AND is_active FOR SHARE",
          [id, read.institute_id],
        )
      ).rowCount
    )
      throw fail(403, "RFID_SCOPE_MISMATCH");
  }
  if ((read.asset_tag_id != null) !== (read.asset_id != null))
    throw fail(409, "RFID_IDENTITY_CHANGED");
  if (read.asset_id != null) {
    const tag = (
      await tx.query(
        "SELECT t.id FROM asset_tags t JOIN assets a ON a.id=t.asset_id AND a.institute_id=t.institute_id WHERE t.id=$1 AND t.asset_id=$2 AND t.institute_id=$3 AND t.epc=$4 AND t.tag_status='ACTIVE' FOR SHARE OF t,a",
        [read.asset_tag_id, read.asset_id, read.institute_id, read.epc],
      )
    ).rows[0];
    if (!tag) throw fail(409, "RFID_IDENTITY_CHANGED");
  }
}
async function timeouts(tx) {
  await tx.query(
    "SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15s'",
  );
}
module.exports = { actor, source, fail, timeouts };
