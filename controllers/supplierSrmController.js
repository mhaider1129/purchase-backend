
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureSuppliersTable, getSupplierById } = require('./suppliersController');

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');

const ensureTables = (() => {
  let ensured = false;
  let ensuring = null;

  return async () => {
    if (ensured) return;
    if (!ensuring) {
      ensuring = (async () => {
        await ensureSuppliersTable();

        await pool.query(`
          CREATE TABLE IF NOT EXISTS supplier_scorecards (
            id SERIAL PRIMARY KEY,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
            request_id INTEGER,
            period_start DATE,
            period_end DATE,
            otif_score NUMERIC(5, 2) NOT NULL,
            quality_defects INTEGER DEFAULT 0,
            lead_time_variance NUMERIC(8, 2),
            notes TEXT,
            created_by INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS supplier_issues (
            id SERIAL PRIMARY KEY,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
            request_id INTEGER,
            description TEXT NOT NULL,
            severity TEXT DEFAULT 'medium',
            status TEXT NOT NULL DEFAULT 'open',
            capa_required BOOLEAN DEFAULT FALSE,
            capa_plan TEXT,
            due_date DATE,
            resolved_at TIMESTAMPTZ,
            created_by INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS supplier_compliance_artifacts (
            id SERIAL PRIMARY KEY,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            artifact_type TEXT NOT NULL,
            name TEXT NOT NULL,
            document_url TEXT,
            expiry_date DATE,
            status TEXT NOT NULL DEFAULT 'active',
            blocked BOOLEAN NOT NULL DEFAULT FALSE,
            created_by INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        ensured = true;
        ensuring = null;
      })();
    }

    await ensuring;
  };
})();

const parseNumericScore = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    throw createHttpError(400, `${fieldName} is required`);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw createHttpError(400, `${fieldName} must be numeric`);
  }

  return Math.round(numeric * 100) / 100;
};

const parseInteger = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw createHttpError(400, `${fieldName} must be a non-negative integer`);
  }
  return numeric;
};

const parseDate = (value, fieldName) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid date`);
  }
  return date.toISOString().slice(0, 10);
};

const computeComplianceStatus = artifact => {
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = Boolean(artifact.expiry_date) && artifact.expiry_date < today;
  const blocked = artifact.blocked || artifact.status === 'blocked' || isExpired;
  return {
    ...artifact,
    is_expired: isExpired,
    blocked,
  };
};

const getComplianceStatusBySupplierIds = async supplierIds => {
  if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
    return new Map();
  }

  await ensureTables();
  const placeholders = supplierIds.map((_, idx) => `$${idx + 1}`).join(', ');
  const { rows } = await pool.query(
    `SELECT supplier_id, MIN(expiry_date) AS next_expiry,
            BOOL_OR(blocked OR (expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE)) AS is_blocked
       FROM supplier_compliance_artifacts
      WHERE supplier_id IN (${placeholders})
      GROUP BY supplier_id`,
    supplierIds
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.supplier_id, {
      supplier_id: row.supplier_id,
      next_expiry: row.next_expiry,
      blocked: row.is_blocked || false,
    });
  }
  return map;
};

const ensureSupplierExists = async supplierId => {
  const supplier = await getSupplierById(pool, supplierId);
  if (!supplier) {
    throw createHttpError(404, 'Supplier not found');
  }
  return supplier;
};

const listSupplierScorecards = async (req, res, next) => {
  const supplierId = Number(req.params.supplierId);
  if (!Number.isInteger(supplierId)) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureTables();
    await ensureSupplierExists(supplierId);

    const { rows } = await pool.query(
      `SELECT id, supplier_id, contract_id, request_id, period_start, period_end,
              otif_score, quality_defects, lead_time_variance, notes,
              created_by, created_at, updated_at
         FROM supplier_scorecards
        WHERE supplier_id = $1
        ORDER BY COALESCE(period_end, period_start) DESC NULLS LAST, created_at DESC`,
      [supplierId]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list supplier scorecards:', err);
    next(createHttpError(500, 'Failed to load supplier scorecards'));
  }
};

const createSupplierScorecard = async (req, res, next) => {
  const supplierId = Number(req.params.supplierId);
  if (!Number.isInteger(supplierId)) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureTables();
    await ensureSupplierExists(supplierId);

    const otifScore = parseNumericScore(req.body?.otif_score, 'otif_score');
    const qualityDefects = parseInteger(req.body?.quality_defects, 'quality_defects');
    const leadTimeVariance = parseNumericScore(
      req.body?.lead_time_variance,
      'lead_time_variance'
    );
    const periodStart = parseDate(req.body?.period_start, 'period_start');
    const periodEnd = parseDate(req.body?.period_end, 'period_end');
    const contractId = req.body?.contract_id ? Number(req.body.contract_id) : null;
    const requestId = req.body?.request_id ? Number(req.body.request_id) : null;
    const notes = normalizeText(req.body?.notes) || null;

    const { rows } = await pool.query(
      `INSERT INTO supplier_scorecards (
         supplier_id, contract_id, request_id, period_start, period_end,
         otif_score, quality_defects, lead_time_variance, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, supplier_id, contract_id, request_id, period_start, period_end,
                 otif_score, quality_defects, lead_time_variance, notes,
                 created_by, created_at, updated_at`,
      [
        supplierId,
        contractId || null,
        requestId || null,
        periodStart,
        periodEnd,
        otifScore,
        qualityDefects,
        leadTimeVariance,
        notes,
        req.user?.id || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create supplier scorecard:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to create supplier scorecard'));
  }
};

const listSupplierIssues = async (req, res, next) => {
  const supplierId = Number(req.params.supplierId);
  if (!Number.isInteger(supplierId)) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureTables();
    await ensureSupplierExists(supplierId);

    const { rows } = await pool.query(
      `SELECT id, supplier_id, contract_id, request_id, description, severity, status,
              capa_required, capa_plan, due_date, resolved_at, created_by,
              created_at, updated_at
         FROM supplier_issues
        WHERE supplier_id = $1
        ORDER BY created_at DESC`,
      [supplierId]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list supplier issues:', err);
    next(createHttpError(500, 'Failed to load supplier issues'));
  }
};

const createSupplierIssue = async (req, res, next) => {
  const supplierId = Number(req.params.supplierId);
  if (!Number.isInteger(supplierId)) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  const description = normalizeText(req.body?.description);
  if (!description) {
    return next(createHttpError(400, 'description is required'));
  }

  try {
    await ensureTables();
    await ensureSupplierExists(supplierId);

    const severity = normalizeText(req.body?.severity) || 'medium';
    const status = normalizeText(req.body?.status) || 'open';
    const capaRequired = Boolean(req.body?.capa_required);
    const capaPlan = normalizeText(req.body?.capa_plan) || null;
    const dueDate = parseDate(req.body?.due_date, 'due_date');
    const contractId = req.body?.contract_id ? Number(req.body.contract_id) : null;
    const requestId = req.body?.request_id ? Number(req.body.request_id) : null;

    const { rows } = await pool.query(
      `INSERT INTO supplier_issues (
         supplier_id, contract_id, request_id, description, severity, status,
         capa_required, capa_plan, due_date, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, supplier_id, contract_id, request_id, description, severity, status,
                 capa_required, capa_plan, due_date, resolved_at, created_by,
                 created_at, updated_at`,
      [
        supplierId,
        contractId,
        requestId,
        description,
        severity,
        status,
        capaRequired,
        capaPlan,
        dueDate,
        req.user?.id || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to create supplier issue:', err);
    if (err.statusCode) return next(err);
    next(createHttpError(500, 'Failed to create supplier issue'));
  }
};

const updateSupplierIssue = async (req, res, next) => {
  const issueId = Number(req.params.issueId);
  if (!Number.isInteger(issueId)) {
    return next(createHttpError(400, 'Invalid issue id'));
  }

  try {
    await ensureTables();
    const existing = await pool.query(
      `SELECT id FROM supplier_issues WHERE id = $1 LIMIT 1`,
      [issueId]
    );

    if (existing.rowCount === 0) {
      return next(createHttpError(404, 'Supplier issue not found'));
    }

    const fields = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      fields.push(`status = $${fields.length + 1}`);
      values.push(normalizeText(req.body.status) || 'open');
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'capa_plan')) {
      fields.push(`capa_plan = $${fields.length + 1}`);
      values.push(normalizeText(req.body.capa_plan) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'capa_required')) {
      fields.push(`capa_required = $${fields.length + 1}`);
      values.push(Boolean(req.body.capa_required));
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'due_date')) {
      fields.push(`due_date = $${fields.length + 1}`);
      values.push(parseDate(req.body.due_date, 'due_date'));
    }

    if (fields.length === 0) {
      return res.json({ message: 'No updates applied' });
    }

    const status = normalizeText(req.body?.status);
    if (status && status.toLowerCase() === 'closed') {
      fields.push(`resolved_at = NOW()`);
    }

    fields.push(`updated_at = NOW()`);
    values.push(issueId);

    const { rows } = await pool.query(
      `UPDATE supplier_issues
          SET ${fields.join(', ')}
        WHERE id = $${values.length}
      RETURNING id, supplier_id, contract_id, request_id, description, severity, status,
                capa_required, capa_plan, due_date, resolved_at, created_by,
                created_at, updated_at`,
      values
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Failed to update supplier issue:', err);
    if (err.statusCode) return next(err);
    next(createHttpError(500, 'Failed to update supplier issue'));
  }
};

const listComplianceArtifacts = async (req, res, next) => {
  const supplierId = Number(req.params.supplierId);
  if (!Number.isInteger(supplierId)) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureTables();
    await ensureSupplierExists(supplierId);

    const { rows } = await pool.query(
      `SELECT id, supplier_id, artifact_type, name, document_url, expiry_date,
              status, blocked, created_by, created_at, updated_at
         FROM supplier_compliance_artifacts
        WHERE supplier_id = $1
        ORDER BY expiry_date ASC NULLS LAST, created_at DESC`,
      [supplierId]
    );

    res.json(rows.map(computeComplianceStatus));
  } catch (err) {
    console.error('❌ Failed to list compliance artifacts:', err);
    next(createHttpError(500, 'Failed to load supplier compliance'));
  }
};

const createComplianceArtifact = async (req, res, next) => {
  const supplierId = Number(req.params.supplierId);
  if (!Number.isInteger(supplierId)) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  const artifactType = normalizeText(req.body?.artifact_type);
  const name = normalizeText(req.body?.name);

  if (!artifactType) {
    return next(createHttpError(400, 'artifact_type is required'));
  }

  if (!name) {
    return next(createHttpError(400, 'name is required'));
  }

  try {
    await ensureTables();
    await ensureSupplierExists(supplierId);

    const expiryDate = parseDate(req.body?.expiry_date, 'expiry_date');
    const documentUrl = normalizeText(req.body?.document_url) || null;
    const status = normalizeText(req.body?.status) || 'active';
    const blocked = Boolean(req.body?.blocked);

    const { rows } = await pool.query(
      `INSERT INTO supplier_compliance_artifacts (
         supplier_id, artifact_type, name, document_url, expiry_date, status, blocked, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, supplier_id, artifact_type, name, document_url, expiry_date,
                 status, blocked, created_by, created_at, updated_at`,
      [
        supplierId,
        artifactType,
        name,
        documentUrl,
        expiryDate,
        status,
        blocked,
        req.user?.id || null,
      ]
    );

    res.status(201).json(computeComplianceStatus(rows[0]));
  } catch (err) {
    console.error('❌ Failed to create compliance artifact:', err);
    if (err.statusCode) return next(err);
    next(createHttpError(500, 'Failed to create compliance artifact'));
  }
};

const getSupplierSrmStatus = async (req, res, next) => {
  const supplierId = Number(req.params.supplierId);
  if (!Number.isInteger(supplierId)) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureTables();
    await ensureSupplierExists(supplierId);

    const complianceMap = await getComplianceStatusBySupplierIds([supplierId]);
    const compliance = complianceMap.get(supplierId) || { blocked: false, next_expiry: null };

    const scorecardResult = await pool.query(
      `SELECT otif_score, quality_defects, lead_time_variance, period_start, period_end, created_at
         FROM supplier_scorecards
        WHERE supplier_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [supplierId]
    );

    const openIssuesResult = await pool.query(
      `SELECT COUNT(*) AS open_count
         FROM supplier_issues
        WHERE supplier_id = $1 AND status NOT IN ('closed', 'resolved')`,
      [supplierId]
    );

    res.json({
      supplier_id: supplierId,
      compliance,
      latest_scorecard: scorecardResult.rows[0] || null,
      open_issues: Number(openIssuesResult.rows[0]?.open_count || 0),
    });
  } catch (err) {
    console.error('❌ Failed to load SRM status:', err);
    if (err.statusCode) return next(err);
    next(createHttpError(500, 'Failed to load supplier SRM status'));
  }
};

module.exports = {
  listSupplierScorecards,
  createSupplierScorecard,
  listSupplierIssues,
  createSupplierIssue,
  updateSupplierIssue,
  listComplianceArtifacts,
  createComplianceArtifact,
  getComplianceStatusBySupplierIds,
  getSupplierSrmStatus,
};