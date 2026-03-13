const createHttpError = require('../utils/httpError');

const getCurrentFiscalYear = () => new Date().getUTCFullYear();

const resolveBudgetEnvelope = async (client, {
  departmentId,
  projectId = null,
  currency = 'USD',
  fiscalYear = getCurrentFiscalYear(),
}) => {
  const { rows } = await client.query(
    `SELECT *
       FROM budget_envelopes
      WHERE department_id = $1
        AND COALESCE(project_id::text, '') = COALESCE($2::text, '')
        AND fiscal_year = $3
        AND currency = $4
      LIMIT 1`,
    [departmentId, projectId, fiscalYear, currency]
  );

  return rows[0] || null;
};

const getBudgetSnapshot = async (client, budgetEnvelopeId) => {
  const budgetRes = await client.query(
    `SELECT id, allocated_amount, consumed_amount, currency
       FROM budget_envelopes
      WHERE id = $1`,
    [budgetEnvelopeId]
  );

  if (budgetRes.rowCount === 0) {
    throw createHttpError(404, 'Budget envelope not found');
  }

  const totalsRes = await client.query(
    `SELECT
        COALESCE(SUM(CASE WHEN stage = 'reservation' THEN amount ELSE 0 END), 0) AS reserved,
        COALESCE(SUM(CASE WHEN stage = 'encumbrance' THEN amount ELSE 0 END), 0) AS encumbered,
        COALESCE(SUM(CASE WHEN stage = 'actual' THEN amount ELSE 0 END), 0) AS actual
      FROM commitment_ledger
      WHERE budget_envelope_id = $1`,
    [budgetEnvelopeId]
  );

  const budget = budgetRes.rows[0];
  const totals = totalsRes.rows[0] || {};

  const allocated = Number(budget.allocated_amount) || 0;
  const actual = Number(totals.actual) || 0;
  const reserved = Number(totals.reserved) || 0;
  const encumbered = Number(totals.encumbered) || 0;
  const available = allocated - actual;

  return {
    budget_envelope_id: budget.id,
    currency: budget.currency,
    allocated,
    reserved,
    encumbered,
    actual,
    available,
  };
};

const assertBudgetCanCover = async (client, {
  departmentId,
  projectId = null,
  amount,
  currency = 'USD',
}) => {
  const normalizedAmount = Number(amount) || 0;
  if (normalizedAmount <= 0) {
    return { envelope: null, snapshot: null };
  }

  const envelope = await resolveBudgetEnvelope(client, {
    departmentId,
    projectId,
    currency,
  });

  if (!envelope) {
    throw createHttpError(
      409,
      'No active budget envelope found for this department/project and fiscal year'
    );
  }

  const snapshot = await getBudgetSnapshot(client, envelope.id);
  if (snapshot.available < normalizedAmount) {
    throw createHttpError(
      409,
      `Budget exceeded. Available ${snapshot.available.toFixed(2)} ${snapshot.currency}, required ${normalizedAmount.toFixed(2)} ${snapshot.currency}`
    );
  }

  return { envelope, snapshot };
};

const recordCommitment = async (client, {
  requestId,
  budgetEnvelopeId,
  stage,
  amount,
  currency = 'USD',
  sourceType = null,
  sourceId = null,
  notes = null,
  actorId = null,
}) => {
  const normalizedAmount = Number(amount) || 0;
  if (normalizedAmount <= 0) {
    return null;
  }

  const { rows } = await client.query(
    `INSERT INTO commitment_ledger (
      request_id,
      budget_envelope_id,
      stage,
      amount,
      currency,
      source_type,
      source_id,
      notes,
      actor_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *`,
    [
      requestId,
      budgetEnvelopeId,
      stage,
      normalizedAmount,
      currency,
      sourceType,
      sourceId,
      notes,
      actorId,
    ]
  );

  if (stage === 'actual') {
    await client.query(
      `UPDATE budget_envelopes
          SET consumed_amount = consumed_amount + $2,
              updated_at = NOW()
        WHERE id = $1`,
      [budgetEnvelopeId, normalizedAmount]
    );
  }

  return rows[0];
};

const postProcureToPayAccrual = async (client, {
  requestId,
  sourceId,
  amount,
  currency = 'USD',
  costCenterId = null,
  actorId = null,
}) => {
  const normalizedAmount = Number(amount) || 0;
  if (normalizedAmount <= 0) {
    return null;
  }

  const postingReference = `GL-P2P-${requestId}-${Date.now()}`;
  const postingRes = await client.query(
    `INSERT INTO gl_postings (
      request_id,
      source_type,
      source_id,
      posting_reference,
      posting_status,
      currency,
      total_amount,
      posted_by
    ) VALUES ($1, 'supplier_invoice', $2, $3, 'posted', $4, $5, $6)
    RETURNING *`,
    [requestId, String(sourceId), postingReference, currency, normalizedAmount, actorId]
  );

  const postingId = postingRes.rows[0].id;

  await client.query(
    `INSERT INTO gl_posting_lines (
      gl_posting_id,
      line_no,
      account_code,
      cost_center_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES
      ($1, 1, '5000-PROC-EXP', $2, $3, 0, 'Procurement expense recognition'),
      ($1, 2, '2100-AP-ACCRUAL', $2, 0, $3, 'Accounts payable accrual')`,
    [postingId, costCenterId, normalizedAmount]
  );

  return postingRes.rows[0];
};

module.exports = {
  resolveBudgetEnvelope,
  getBudgetSnapshot,
  assertBudgetCanCover,
  recordCommitment,
  postProcureToPayAccrual,
};