
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

const OBLIGATION_STATUSES = new Set(['Pending', 'Completed', 'Overdue', 'Cancelled']);
const PROCUREMENT_METHODS = new Set([
  'RFQ',
  'Tender',
  'Direct Purchase',
  'Emergency Purchase',
  'Framework Agreement',
  'Sole Source',
  'Annual Bid',
]);

const ensureGovernanceTables = (() => {
  let ensured = false;
  let ensuringPromise = null;

  return async () => {
    if (ensured) return;
    if (!ensuringPromise) {
      ensuringPromise = (async () => {
        await pool.query(`ALTER TABLE contracts
          ADD COLUMN IF NOT EXISTS is_framework_agreement BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS framework_ceiling_value NUMERIC(14,2),
          ADD COLUMN IF NOT EXISTS framework_remaining_balance NUMERIC(14,2),
          ADD COLUMN IF NOT EXISTS framework_start_date DATE,
          ADD COLUMN IF NOT EXISTS framework_end_date DATE,
          ADD COLUMN IF NOT EXISTS procurement_method TEXT,
          ADD COLUMN IF NOT EXISTS reserve_budget_on_activation BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS committed_value NUMERIC(14,2),
          ADD COLUMN IF NOT EXISTS block_overspend BOOLEAN NOT NULL DEFAULT FALSE`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_templates (
          id SERIAL PRIMARY KEY,
          template_name TEXT NOT NULL,
          contract_category TEXT,
          contract_type TEXT,
          default_currency TEXT,
          default_sections JSONB,
          default_clauses JSONB,
          default_alert_rules JSONB,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_clauses (
          id SERIAL PRIMARY KEY,
          clause_type TEXT,
          clause_title TEXT NOT NULL,
          clause_content TEXT NOT NULL,
          clause_version INTEGER NOT NULL DEFAULT 1,
          language TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_clause_assignments (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          clause_id INTEGER NOT NULL REFERENCES contract_clauses(id) ON DELETE CASCADE,
          custom_override_content TEXT,
          sort_order INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_obligations (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          obligation_type TEXT,
          title TEXT NOT NULL,
          description TEXT,
          responsible_party TEXT,
          due_date DATE,
          status TEXT NOT NULL DEFAULT 'Pending',
          completion_notes TEXT,
          completed_at TIMESTAMPTZ,
          proof_attachment_id INTEGER,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_sla_events (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          event_type TEXT,
          response_time_minutes INTEGER,
          resolution_time_minutes INTEGER,
          target_response_minutes INTEGER,
          target_resolution_minutes INTEGER,
          breached BOOLEAN NOT NULL DEFAULT FALSE,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_negotiations (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          negotiation_round INTEGER NOT NULL,
          discussion_summary TEXT,
          requested_changes JSONB,
          approved_changes JSONB,
          rejected_changes JSONB,
          negotiated_value NUMERIC(14,2),
          negotiated_terms JSONB,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_legal_reviews (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          reviewer_id INTEGER,
          legal_risk_level TEXT,
          flagged_clauses JSONB,
          approved_clauses JSONB,
          comments TEXT,
          governing_law TEXT,
          jurisdiction TEXT,
          approved BOOLEAN,
          reviewed_at TIMESTAMPTZ
        )`);


        await pool.query(`CREATE TABLE IF NOT EXISTS contract_payments (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          amount NUMERIC(14,2) NOT NULL,
          currency TEXT,
          payment_date TIMESTAMPTZ NOT NULL,
          notes TEXT,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contract_versions (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          snapshot JSONB NOT NULL,
          change_summary TEXT,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

        ensured = true;
      })().finally(() => {
        ensuringPromise = null;
      });
    }

    await ensuringPromise;
  };
})();

const parseId = (value, label = 'id') => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createHttpError(400, `${label} must be a positive integer`);
  }
  return parsed;
};

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');

const ensureProcurementMethod = value => {
  if (value === null || value === undefined || value === '') return null;
  if (!PROCUREMENT_METHODS.has(value)) {
    throw createHttpError(400, `procurement_method must be one of: ${Array.from(PROCUREMENT_METHODS).join(', ')}`);
  }
  return value;
};

const listTemplates = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const { rows } = await pool.query('SELECT * FROM contract_templates ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

const getTemplate = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const id = parseId(req.params.id, 'template id');
    const { rows } = await pool.query('SELECT * FROM contract_templates WHERE id = $1', [id]);
    if (!rows[0]) throw createHttpError(404, 'Template not found');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const createTemplate = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const body = req.body || {};
    const templateName = normalizeText(body.template_name);
    if (!templateName) throw createHttpError(400, 'template_name is required');

    const { rows } = await pool.query(
      `INSERT INTO contract_templates
       (template_name, contract_category, contract_type, default_currency, default_sections, default_clauses, default_alert_rules, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        templateName,
        body.contract_category || null,
        body.contract_type || null,
        body.default_currency || null,
        body.default_sections || null,
        body.default_clauses || null,
        body.default_alert_rules || null,
        req.user?.id || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateTemplate = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const id = parseId(req.params.id, 'template id');
    const body = req.body || {};

    const templateName = body.template_name === undefined ? undefined : normalizeText(body.template_name);
    if (templateName !== undefined && !templateName) {
      throw createHttpError(400, 'template_name cannot be empty');
    }

    const { rows } = await pool.query(
      `UPDATE contract_templates
       SET template_name = COALESCE($2, template_name),
           contract_category = COALESCE($3, contract_category),
           contract_type = COALESCE($4, contract_type),
           default_currency = COALESCE($5, default_currency),
           default_sections = COALESCE($6, default_sections),
           default_clauses = COALESCE($7, default_clauses),
           default_alert_rules = COALESCE($8, default_alert_rules),
           is_active = COALESCE($9, is_active),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        templateName,
        body.contract_category,
        body.contract_type,
        body.default_currency,
        body.default_sections,
        body.default_clauses,
        body.default_alert_rules,
        body.is_active,
      ]
    );

    if (!rows[0]) throw createHttpError(404, 'Template not found');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const deleteTemplate = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const id = parseId(req.params.id, 'template id');
    await pool.query('DELETE FROM contract_templates WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const listClauses = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const { rows } = await pool.query('SELECT * FROM contract_clauses ORDER BY clause_title');
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

const createClause = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const body = req.body || {};
    const title = normalizeText(body.clause_title);
    const content = normalizeText(body.clause_content);
    if (!title) throw createHttpError(400, 'clause_title is required');
    if (!content) throw createHttpError(400, 'clause_content is required');

    const { rows } = await pool.query(
      `INSERT INTO contract_clauses (clause_type, clause_title, clause_content, clause_version, language, created_by)
       VALUES ($1, $2, $3, COALESCE($4, 1), $5, $6)
       RETURNING *`,
      [body.clause_type || null, title, content, body.clause_version, body.language || 'en', req.user?.id || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateClause = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const id = parseId(req.params.id, 'clause id');
    const body = req.body || {};

    const title = body.clause_title === undefined ? undefined : normalizeText(body.clause_title);
    const content = body.clause_content === undefined ? undefined : normalizeText(body.clause_content);
    if (title !== undefined && !title) throw createHttpError(400, 'clause_title cannot be empty');
    if (content !== undefined && !content) throw createHttpError(400, 'clause_content cannot be empty');

    const { rows } = await pool.query(
      `UPDATE contract_clauses
       SET clause_type = COALESCE($2, clause_type),
           clause_title = COALESCE($3, clause_title),
           clause_content = COALESCE($4, clause_content),
           clause_version = COALESCE($5, clause_version),
           language = COALESCE($6, language),
           is_active = COALESCE($7, is_active),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, body.clause_type, title, content, body.clause_version, body.language, body.is_active]
    );

    if (!rows[0]) throw createHttpError(404, 'Clause not found');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const deleteClause = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const id = parseId(req.params.id, 'clause id');
    await pool.query('DELETE FROM contract_clauses WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const getContractHealth = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');

    const contractResult = await pool.query('SELECT * FROM contracts WHERE id = $1', [contractId]);
    const contract = contractResult.rows[0];
    if (!contract) throw createHttpError(404, 'Contract not found');

    const required = (
      await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_uploaded)::int AS done
         FROM contract_required_documents
         WHERE contract_id = $1`,
        [contractId]
      )
    ).rows[0];

    const evaluations = (
      await pool.query(
        `SELECT COALESCE(AVG(total_score), 0)::numeric AS avg
         FROM contract_evaluations
         WHERE contract_id = $1`,
        [contractId]
      )
    ).rows[0];

    const sla = (
      await pool.query(
        `SELECT COUNT(*) FILTER (WHERE breached)::int AS breaches
         FROM contract_sla_events
         WHERE contract_id = $1`,
        [contractId]
      )
    ).rows[0];

    const consumption = Number(contract.contract_value || 0) > 0
      ? (Number(contract.amount_paid || 0) / Number(contract.contract_value || 0)) * 100
      : 0;

    let healthScore = 100;
    const warnings = [];

    if (!contract.signing_date) {
      healthScore -= 12;
      warnings.push('Missing signed contract date');
    }

    if (contract.end_date && new Date(contract.end_date) < new Date()) {
      healthScore -= 20;
      warnings.push('Contract expired');
    }

    if (contract.end_date && (new Date(contract.end_date) - new Date()) / (1000 * 3600 * 24) <= 30) {
      healthScore -= 10;
      warnings.push('Contract expiring within 30 days');
    }

    if (Number(required.total || 0) > 0 && Number(required.done || 0) < Number(required.total || 0)) {
      healthScore -= 10;
      warnings.push('Required documents missing');
    }

    if (Number(evaluations.avg || 0) === 0) {
      healthScore -= 8;
      warnings.push('No evaluations found');
    }

    if (consumption > 100) {
      healthScore -= 18;
      warnings.push('Consumption exceeded 100%');
    } else if (consumption > 80) {
      healthScore -= 8;
      warnings.push('Consumption above 80%');
    }

    if (Number(sla.breaches || 0) > 0) {
      healthScore -= 12;
      warnings.push('Unresolved SLA breaches exist');
    }

    const score = Math.max(0, Math.round(healthScore));
    const riskLevel = score >= 80 ? 'Green' : score >= 60 ? 'Yellow' : score >= 40 ? 'Orange' : 'Red';
    const completion = Math.round((Number(required.done || 0) / Math.max(Number(required.total || 0), 1)) * 100);

    res.json({
      health_score: score,
      compliance_percentage: completion,
      document_completion_percentage: completion,
      evaluation_score: Number(evaluations.avg || 0),
      consumption_percentage: Number(consumption.toFixed(2)),
      risk_level: riskLevel,
      warnings,
    });
  } catch (err) {
    next(err);
  }
};

const listObligations = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');
    const { rows } = await pool.query(
      'SELECT * FROM contract_obligations WHERE contract_id = $1 ORDER BY due_date NULLS LAST, id DESC',
      [contractId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

const createObligation = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');
    const body = req.body || {};
    const title = normalizeText(body.title);
    if (!title) throw createHttpError(400, 'title is required');

    const status = body.status || 'Pending';
    if (!OBLIGATION_STATUSES.has(status)) {
      throw createHttpError(400, `status must be one of: ${Array.from(OBLIGATION_STATUSES).join(', ')}`);
    }

    const { rows } = await pool.query(
      `INSERT INTO contract_obligations
       (contract_id, obligation_type, title, description, responsible_party, due_date, status, completion_notes, proof_attachment_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        contractId,
        body.obligation_type || null,
        title,
        body.description || null,
        body.responsible_party || null,
        body.due_date || null,
        status,
        body.completion_notes || null,
        body.proof_attachment_id || null,
        req.user?.id || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateObligation = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');
    const obligationId = parseId(req.params.obligationId, 'obligation id');
    const body = req.body || {};

    if (body.status !== undefined && !OBLIGATION_STATUSES.has(body.status)) {
      throw createHttpError(400, `status must be one of: ${Array.from(OBLIGATION_STATUSES).join(', ')}`);
    }

    const title = body.title === undefined ? undefined : normalizeText(body.title);
    if (title !== undefined && !title) throw createHttpError(400, 'title cannot be empty');

    const { rows } = await pool.query(
      `UPDATE contract_obligations
       SET obligation_type = COALESCE($3, obligation_type),
           title = COALESCE($4, title),
           description = COALESCE($5, description),
           responsible_party = COALESCE($6, responsible_party),
           due_date = COALESCE($7, due_date),
           status = COALESCE($8, status),
           completion_notes = COALESCE($9, completion_notes),
           completed_at = COALESCE($10, completed_at),
           proof_attachment_id = COALESCE($11, proof_attachment_id),
           updated_at = NOW()
       WHERE contract_id = $1 AND id = $2
       RETURNING *`,
      [
        contractId,
        obligationId,
        body.obligation_type,
        title,
        body.description,
        body.responsible_party,
        body.due_date,
        body.status,
        body.completion_notes,
        body.completed_at,
        body.proof_attachment_id,
      ]
    );

    if (!rows[0]) throw createHttpError(404, 'Obligation not found');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

const deleteObligation = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');
    const obligationId = parseId(req.params.obligationId, 'obligation id');
    await pool.query('DELETE FROM contract_obligations WHERE contract_id = $1 AND id = $2', [contractId, obligationId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const updateContractGovernanceFields = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');
    const body = req.body || {};

    const procurementMethod = ensureProcurementMethod(body.procurement_method);

    const { rows } = await pool.query(
      `UPDATE contracts
       SET is_framework_agreement = COALESCE($2, is_framework_agreement),
           framework_ceiling_value = COALESCE($3, framework_ceiling_value),
           framework_remaining_balance = COALESCE($4, framework_remaining_balance),
           framework_start_date = COALESCE($5, framework_start_date),
           framework_end_date = COALESCE($6, framework_end_date),
           procurement_method = COALESCE($7, procurement_method),
           reserve_budget_on_activation = COALESCE($8, reserve_budget_on_activation),
           committed_value = COALESCE($9, committed_value),
           block_overspend = COALESCE($10, block_overspend),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        contractId,
        body.is_framework_agreement,
        body.framework_ceiling_value,
        body.framework_remaining_balance,
        body.framework_start_date,
        body.framework_end_date,
        procurementMethod,
        body.reserve_budget_on_activation,
        body.committed_value,
        body.block_overspend,
      ]
    );

    if (!rows[0]) throw createHttpError(404, 'Contract not found');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};


const listContractPayments = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');
    const { rows } = await pool.query(
      'SELECT * FROM contract_payments WHERE contract_id = $1 ORDER BY payment_date DESC, id DESC',
      [contractId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

const createContractPayment = async (req, res, next) => {
  try {
    await ensureGovernanceTables();
    const contractId = parseId(req.params.id, 'contract id');
    const body = req.body || {};
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw createHttpError(400, 'amount must be a positive number');
    const paymentDate = body.payment_date || new Date().toISOString();

    const { rows } = await pool.query(
      `INSERT INTO contract_payments (contract_id, amount, currency, payment_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [contractId, amount, body.currency || null, paymentDate, body.notes || null, req.user?.id || null]
    );

    await pool.query('UPDATE contracts SET amount_paid = COALESCE((SELECT SUM(amount) FROM contract_payments WHERE contract_id = $1), 0), updated_at = NOW() WHERE id = $1', [contractId]);

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  ensureGovernanceTables,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listClauses,
  createClause,
  updateClause,
  deleteClause,
  getContractHealth,
  listObligations,
  createObligation,
  updateObligation,
  deleteObligation,
  updateContractGovernanceFields,
  listContractPayments,
  createContractPayment,
};