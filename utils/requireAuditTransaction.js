"use strict";
module.exports = async (client) => {
  if (!client?.query)
    throw Object.assign(
      new Error("Transactional audit requires the business transaction client"),
      { code: "AUDIT_TRANSACTION_REQUIRED" },
    );
  const result = await client.query(
    "SELECT pg_current_xact_id_if_assigned()::text transaction_id",
  );
  if (!result.rows[0]?.transaction_id)
    throw Object.assign(
      new Error("Business mutation and audit must share an open transaction"),
      { code: "AUDIT_TRANSACTION_REQUIRED" },
    );
};
