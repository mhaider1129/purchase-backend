"use strict";
const crypto = require("crypto");
// Reader-context identity, never EPC alone. Raw payload is evidence, not an operation key.
module.exports = (read) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        String(read.reader_id),
        read.antenna_id == null ? null : String(read.antenna_id),
        read.portal_id == null ? null : String(read.portal_id),
        read.external_event_id || null,
        read.epc,
        read.tid || null,
        new Date(read.read_timestamp).toISOString(),
        read.source_type,
        read.rssi == null ? null : Number(read.rssi),
      ]),
    )
    .digest("hex");
