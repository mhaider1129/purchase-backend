"use strict";
const pool = require("../config/db");
const boundary = require("../services/contractAuthorizationService");
const { project } = require("../services/contractFinancialProjectionService");
const { fail } = require("../services/contractFinanceIntegrationService");
async function getCanonicalContractFinancialSummary(req, res, next) {
  let client;
  try {
    if (
      !/^\d+$/.test(String(req.params.id)) ||
      !Number.isSafeInteger(Number(req.params.id)) ||
      Number(req.params.id) < 1
    )
      throw fail(
        "A positive contract ID is required",
        "INVALID_CONTRACT_ID",
        400,
      );
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const actor = await boundary.actor(req.user, client);
    if (
      !actor.hasPermission("contracts.manage") ||
      !actor.hasPermission("procure-to-pay.lifecycle.view")
    )
      throw fail(
        "Contract financial view requires contracts.manage and procure-to-pay.lifecycle.view",
        "CONTRACT_ACCESS_DENIED",
        403,
      );
    await require("../services/contractFinanceIntegrationService").schema(
      client,
    );
    const contract = await boundary.root(
      client,
      actor,
      req.params.id,
      "manage",
      false,
    );
    if (String(contract.resolved_institute_id) !== String(actor.institute_id))
      throw fail("Contract or reference not found", "CONTRACT_NOT_FOUND", 404);
    const data = await project(client, contract, actor);
    await client.query("COMMIT");
    return res.json(data);
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    return next(error);
  } finally {
    client?.release();
  }
}
module.exports = { getCanonicalContractFinancialSummary };
