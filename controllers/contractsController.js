const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureContractEvaluationsTable } = require('./contractEvaluationsController');
const {
  ensureSuppliersTable,
  findOrCreateSupplierByName,
  getSupplierById,
} = require('./suppliersController');

const CONTRACT_STATUSES = [
  'draft',
  'active',
  'on-hold',
  'expired',
  'terminated',
  'archived',
];

const CRITERION_CODES = {
  CONTRACT_COMPLIANCE: 'contract_compliance',
  SUPPLIER_PERFORMANCE: 'supplier_contractor_performance',
  FINANCIAL_PERFORMANCE: 'financial_performance',
  RISK_ISSUE_MANAGEMENT: 'risk_issue_management',
  SUSTAINABILITY_COMPLIANCE: 'sustainability_compliance',
  STAKEHOLDER_SATISFACTION: 'stakeholder_satisfaction',
};

const parseJson = value => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (err) {
      return null;
    }
  }

  if (typeof value === 'object') {
    return value;
  }

  return null;
};

const normalizeIdArray = rawValue => {
  if (rawValue === null || rawValue === undefined) {
    return [];
  }

  let source = rawValue;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') {
      return [];
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      source = parseJson(trimmed);
    } else {
      source = trimmed.split(',').map(part => part.trim()).filter(Boolean);
    }
  } else if (!Array.isArray(rawValue)) {
    source = parseJson(rawValue);
  }

  if (!Array.isArray(source)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const entry of source) {
    const numeric = Number(entry);
    if (Number.isInteger(numeric) && numeric > 0 && !seen.has(numeric)) {
      seen.add(numeric);
      normalized.push(numeric);
    }
  }

  return normalized;
};

const toJsonbParameter = value => {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
};

const parseOptionalInteger = (value, fieldName) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') {
      return null;
    }
    value = trimmed;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw createHttpError(400, `${fieldName} must be a positive integer`);
  }

  return numeric;
};

const fetchRequestById = async (client, requestId) => {
  const parsedId = Number(requestId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return null;
  }

  try {
    const { rows } = await client.query('SELECT id FROM requests WHERE id = $1', [parsedId]);
    return rows[0] || null;
  } catch (err) {
    if (err?.code === '42P01') {
      throw createHttpError(
        400,
        'The requests table is not available yet. Please complete request setup before linking contracts.'
      );
    }

    throw err;
  }
};

const assertRequestExists = async (client, requestId) => {
  if (!requestId) {
    return null;
  }

  const existing = await fetchRequestById(client, requestId);
  if (!existing) {
    throw createHttpError(404, `Request #${requestId} was not found`);
  }

  return existing;
};

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const dedupeUsersById = users => {
  const seen = new Set();
  return (users || []).filter(user => {
    const id = Number(user?.id);
    if (!Number.isInteger(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
};

const fetchActiveUsersByRoles = async (client, roles = []) => {
  const normalizedRoles = Array.from(
    new Set(
      (roles || [])
        .map(role => (typeof role === 'string' ? role.trim().toUpperCase() : ''))
        .filter(Boolean)
    )
  );

  if (normalizedRoles.length === 0) {
    return [];
  }

  const { rows } = await client.query(
    `SELECT id, name, email, role, department_id
       FROM users
      WHERE is_active = TRUE
        AND UPPER(role) = ANY($1::TEXT[])
      ORDER BY ARRAY_POSITION($1::TEXT[], UPPER(role)), id`,
    [normalizedRoles]
  );

  return rows;
};

const fetchHodsForDepartments = async (client, departmentIds = []) => {
  const normalized = Array.from(
    new Set(
      (departmentIds || [])
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    )
  );

  if (normalized.length === 0) {
    return [];
  }

  const { rows } = await client.query(
    `SELECT id, name, email, role, department_id
       FROM users
      WHERE is_active = TRUE
        AND UPPER(role) = 'HOD'
        AND department_id = ANY($1::INT[])`,
    [normalized]
  );

  return rows;
};

const fetchEndUserEvaluators = async (client, contract) => {
  if (contract?.end_user_department_id) {
    const hods = await fetchHodsForDepartments(client, [contract.end_user_department_id]);
    if (hods.length > 0) {
      return hods;
    }
  }

  return fetchActiveUsersByRoles(client, ['CMO', 'COO']);
};

const fetchTechnicalDepartmentEvaluators = async (client, contract) => {
  const departmentIds = Array.isArray(contract?.technical_department_ids)
    ? contract.technical_department_ids
    : [];
  if (!departmentIds.length) {
    return [];
  }

  return fetchHodsForDepartments(client, departmentIds);
};

const fetchContractManagerEvaluator = async (client, contractManagerId) => {
  const parsedId = Number(contractManagerId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return [];
  }

  const { rows } = await client.query(
    `SELECT id, name, email, role, department_id
       FROM users
      WHERE id = $1
        AND is_active = TRUE
      LIMIT 1`,
    [parsedId]
  );

  return rows;
};

const fetchOhsEvaluators = async client => {
  const { rows } = await client.query(
    `SELECT u.id, u.name, u.email, u.role, u.department_id
       FROM users u
       JOIN departments d ON d.id = u.department_id
      WHERE u.is_active = TRUE
        AND UPPER(u.role) = 'HOD'
        AND (
          LOWER(d.type) = 'ohs' OR
          LOWER(d.type) LIKE 'ohs %' OR
          LOWER(d.name) LIKE 'ohs%' OR
          LOWER(d.name) LIKE '%occupational health%'
        )`
  );

  if (rows.length > 0) {
    return rows;
  }

  return fetchActiveUsersByRoles(client, ['OHS']);
};

const determineEvaluatorsForCriterion = async ({ client, criterion, contract }) => {
  const code = (criterion?.code || '').toLowerCase();
  let evaluators = [];

  switch (code) {
    case CRITERION_CODES.CONTRACT_COMPLIANCE:
    case CRITERION_CODES.FINANCIAL_PERFORMANCE:
      evaluators = await fetchActiveUsersByRoles(client, ['SCM']);
      break;
    case CRITERION_CODES.SUPPLIER_PERFORMANCE:
      evaluators = [
        ...(await fetchEndUserEvaluators(client, contract)),
        ...(await fetchTechnicalDepartmentEvaluators(client, contract)),
      ];
      break;
    case CRITERION_CODES.RISK_ISSUE_MANAGEMENT:
      evaluators = [
        ...(await fetchContractManagerEvaluator(client, contract?.contract_manager_id)),
        ...(await fetchEndUserEvaluators(client, contract)),
      ];
      break;
    case CRITERION_CODES.SUSTAINABILITY_COMPLIANCE:
      evaluators = await fetchOhsEvaluators(client);
      break;
    case CRITERION_CODES.STAKEHOLDER_SATISFACTION:
      evaluators = await fetchEndUserEvaluators(client, contract);
      break;
    default:
      if (criterion?.role) {
        evaluators = await fetchActiveUsersByRoles(client, [criterion.role]);
      }
      break;
  }

  if (!evaluators.length && criterion?.role) {
    evaluators = await fetchActiveUsersByRoles(client, [criterion.role]);
  }

  return dedupeUsersById(evaluators);
};

const normalizeCriterionComponents = rawComponents => {
  const parsed = parseJson(rawComponents);
  const source = Array.isArray(rawComponents)
    ? rawComponents
    : Array.isArray(parsed)
      ? parsed
      : [];

  return source
    .map(component => {
      if (typeof component === 'string') {
        const name = component.trim();
        return name ? { name, score: null } : null;
      }

      if (component && typeof component === 'object') {
        const name = (component.name || component.component || component.label || '').trim();
        if (!name) {
          return null;
        }
        const rawScore = component.score ?? component.value ?? null;
        const numericScore = Number(rawScore);
        return Number.isFinite(numericScore)
          ? { name, score: numericScore }
          : { name, score: null };
      }

      const fallback = String(component || '').trim();
      return fallback ? { name: fallback, score: null } : null;
    })
    .filter(Boolean);
};

const buildEvaluationTemplate = criterion => {
  const components = normalizeCriterionComponents(criterion.components);

  return {
    criterionId: criterion.id || null,
    criterionName: criterion.name || null,
    criterionRole: criterion.role || null,
    criterionCode: criterion.code || null,
    components,
    overallScore: null,
  };
};

const normalizeRoleToken = role =>
  (role || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const canManageContractEvaluations = req =>
  Boolean(req.user?.hasPermission && req.user.hasPermission('contracts.manage'));

const getEvaluationCandidates = async (req, res, next) => {
  if (!canManageContractEvaluations(req)) {
    return next(createHttpError(403, 'You are not authorized to view evaluation candidates'));
  }

  const contractId = Number.parseInt(req.params.contractId, 10);
  if (!Number.isInteger(contractId) || contractId <= 0) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  const rawCriterionId = req.query.criterionId ?? req.query.criterion_id ?? null;
  const rawCriterionCode = req.query.criterionCode ?? req.query.criterion_code ?? null;

  if (!rawCriterionId && !rawCriterionCode) {
    return next(createHttpError(400, 'criterionId or criterionCode is required'));
  }

  let client;
  try {
    await ensureContractsTable();
    client = await pool.connect();

    const contractResult = await client.query(
      `SELECT id, title, vendor, reference_number, start_date, end_date, contract_value, status, description,
              delivery_terms, warranty_terms, performance_management,
              end_user_department_id, contract_manager_id, technical_department_ids,
              created_by, created_at, updated_at
         FROM contracts
        WHERE id = $1
        LIMIT 1`,
      [contractId]
    );

    if (contractResult.rowCount === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    const contract = serializeContract(contractResult.rows[0]);

    let criterionResult;
    if (rawCriterionId) {
      const parsedCriterionId = Number(rawCriterionId);
      if (!Number.isInteger(parsedCriterionId) || parsedCriterionId <= 0) {
        return next(createHttpError(400, 'criterionId must be a positive integer'));
      }

      criterionResult = await client.query(
        `SELECT id, name, role, code, components
           FROM evaluation_criteria
          WHERE id = $1
          LIMIT 1`,
        [parsedCriterionId]
      );
    } else {
      const normalizedCode = normalizeText(rawCriterionCode).toLowerCase();
      if (!normalizedCode) {
        return next(createHttpError(400, 'criterionCode must be provided'));
      }

      criterionResult = await client.query(
        `SELECT id, name, role, code, components
           FROM evaluation_criteria
          WHERE LOWER(code) = $1
          LIMIT 1`,
        [normalizedCode]
      );
    }

    if (criterionResult.rowCount === 0) {
      return next(createHttpError(404, 'Evaluation criterion not found'));
    }

    const criterion = criterionResult.rows[0];
    const evaluators = await determineEvaluatorsForCriterion({ client, criterion, contract });

    res.json(
      evaluators.map(evaluator => ({
        id: evaluator.id,
        name: evaluator.name || null,
        email: evaluator.email || null,
        role: evaluator.role || null,
        department_id: evaluator.department_id || null,
      }))
    );
  } catch (err) {
    console.error('❌ Failed to load evaluation candidates:', err);
    next(createHttpError(500, 'Failed to load evaluation candidates'));
  } finally {
    if (client) {
      client.release();
    }
  }
};

const ensureContractsTable = (() => {
  let tableEnsured = false;
  let referenceIndexStatus = 'pending'; // 'pending' | 'ensured' | 'skipped';
  let foreignKeyEnsured = false;
  let assignmentColumnsEnsured = false;
  let endUserForeignKeyEnsured = false;
  let contractManagerForeignKeyEnsured = false;
  let linkageColumnsEnsured = false;
  let supplierForeignKeyEnsured = false;
  let requestForeignKeyEnsured = false;
  let ensuringPromise = null;

  const ensureTableStructure = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        vendor TEXT NOT NULL,
        reference_number TEXT,
        start_date DATE,
        end_date DATE,
        contract_value NUMERIC(14, 2),
        status TEXT NOT NULL DEFAULT 'active',
        description TEXT,
        delivery_terms TEXT,
        warranty_terms TEXT,
        performance_management TEXT,
        supplier_id INTEGER,
        source_request_id INTEGER,
        end_user_department_id INTEGER,
        contract_manager_id INTEGER,
        technical_department_ids JSONB,
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    tableEnsured = true;
  };

  const ensureAssignmentColumns = async () => {
    if (assignmentColumnsEnsured) {
      return;
    }

    await pool.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS end_user_department_id INTEGER,
        ADD COLUMN IF NOT EXISTS contract_manager_id INTEGER,
        ADD COLUMN IF NOT EXISTS technical_department_ids JSONB
    `);

    assignmentColumnsEnsured = true;
  };

  const ensureLinkageColumns = async () => {
    if (linkageColumnsEnsured) {
      return;
    }

    await pool.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS supplier_id INTEGER,
        ADD COLUMN IF NOT EXISTS source_request_id INTEGER
    `);

    linkageColumnsEnsured = true;
  };

  const ensureReferenceNumberIndex = async () => {
    if (referenceIndexStatus !== 'pending') {
      return;
    }

    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS contracts_reference_number_idx
           ON contracts(reference_number)
           WHERE reference_number IS NOT NULL`
      );
      referenceIndexStatus = 'ensured';
    } catch (err) {
      if (err?.code === '23505') {
        console.warn(
          '⚠️ Skipping unique index contracts_reference_number_idx because duplicate reference numbers exist.'
        );
        referenceIndexStatus = 'skipped';
      } else {
        throw err;
      }
    }
  };

  const ensureCreatedByForeignKey = async () => {
    if (foreignKeyEnsured) {
      return;
    }

    try {
      await pool.query(`
        ALTER TABLE contracts
          ADD CONSTRAINT contracts_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      foreignKeyEnsured = true;
    } catch (err) {
      if (err?.code === '42710') {
        // Constraint already exists
        foreignKeyEnsured = true;
      } else if (err?.code === '42P01') {
        // users table does not exist yet; try again on the next invocation
        console.warn(
          '⚠️ Skipping contracts.created_by foreign key creation because users table is missing.'
        );
      } else {
        throw err;
      }
    }
  };

  const ensureEndUserForeignKey = async () => {
    if (endUserForeignKeyEnsured) {
      return;
    }

    try {
      await pool.query(`
        ALTER TABLE contracts
          ADD CONSTRAINT contracts_end_user_department_id_fkey
          FOREIGN KEY (end_user_department_id) REFERENCES departments(id) ON DELETE SET NULL
      `);
      endUserForeignKeyEnsured = true;
    } catch (err) {
      if (err?.code === '42710') {
        endUserForeignKeyEnsured = true;
      } else if (err?.code === '42P01') {
        console.warn('⚠️ Departments table missing; will retry ensuring end user foreign key later.');
      } else {
        throw err;
      }
    }
  };

  const ensureContractManagerForeignKey = async () => {
    if (contractManagerForeignKeyEnsured) {
      return;
    }

    try {
      await pool.query(`
        ALTER TABLE contracts
          ADD CONSTRAINT contracts_contract_manager_id_fkey
          FOREIGN KEY (contract_manager_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      contractManagerForeignKeyEnsured = true;
    } catch (err) {
      if (err?.code === '42710') {
        contractManagerForeignKeyEnsured = true;
      } else if (err?.code === '42P01') {
        console.warn('⚠️ Users table missing; will retry ensuring contract manager foreign key later.');
      } else {
        throw err;
      }
    }
  };

  const ensureSupplierForeignKey = async () => {
    if (supplierForeignKeyEnsured) {
      return;
    }

    try {
      await ensureSuppliersTable();
      await pool.query(`
        ALTER TABLE contracts
          ADD CONSTRAINT contracts_supplier_id_fkey
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
      `);
      supplierForeignKeyEnsured = true;
    } catch (err) {
      if (err?.code === '42710') {
        supplierForeignKeyEnsured = true;
      } else if (err?.code === '42P01') {
        console.warn('⚠️ Suppliers table missing; will retry ensuring supplier foreign key later.');
      } else {
        throw err;
      }
    }
  };

  const ensureSourceRequestForeignKey = async () => {
    if (requestForeignKeyEnsured) {
      return;
    }

    try {
      await pool.query(`
        ALTER TABLE contracts
          ADD CONSTRAINT contracts_source_request_id_fkey
          FOREIGN KEY (source_request_id) REFERENCES requests(id) ON DELETE RESTRICT
      `);
      requestForeignKeyEnsured = true;
    } catch (err) {
      if (err?.code === '42710') {
        requestForeignKeyEnsured = true;
      } else if (err?.code === '42P01') {
        console.warn('⚠️ Requests table missing; will retry ensuring source request foreign key later.');
      } else {
        throw err;
      }
    }
  };

  return async () => {
    const indexSatisfied = referenceIndexStatus === 'ensured' || referenceIndexStatus === 'skipped';
    const constraintsSatisfied =
      tableEnsured &&
      indexSatisfied &&
      foreignKeyEnsured &&
      assignmentColumnsEnsured &&
      endUserForeignKeyEnsured &&
      contractManagerForeignKeyEnsured &&
      linkageColumnsEnsured &&
      supplierForeignKeyEnsured &&
      requestForeignKeyEnsured;

    if (constraintsSatisfied) {
      return;
    }

    if (!ensuringPromise) {
      ensuringPromise = (async () => {
        try {
          if (!tableEnsured) {
            await ensureTableStructure();
          }

          if (!assignmentColumnsEnsured) {
            await ensureAssignmentColumns();
          }

          if (!linkageColumnsEnsured) {
            await ensureLinkageColumns();
          }

          await ensureReferenceNumberIndex();

          if (!foreignKeyEnsured) {
            await ensureCreatedByForeignKey();
          }

          if (!endUserForeignKeyEnsured) {
            await ensureEndUserForeignKey();
          }

          if (!contractManagerForeignKeyEnsured) {
            await ensureContractManagerForeignKey();
          }

          if (!supplierForeignKeyEnsured) {
            await ensureSupplierForeignKey();
          }

          if (!requestForeignKeyEnsured) {
            await ensureSourceRequestForeignKey();
          }
        } catch (err) {
          console.error('❌ Failed to ensure contracts table exists:', err);
          throw err;
        } finally {
          ensuringPromise = null;
        }
      })();
    }

    await ensuringPromise;
  };
})();

const normalizeStatus = (value) => {
  const status = normalizeText(value).toLowerCase();
  return CONTRACT_STATUSES.includes(status) ? status : null;
};

const parseISODate = (value, fieldName) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid date`);
  }

  return date.toISOString().slice(0, 10);
};

const parseContractValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    throw createHttpError(400, 'contract_value must be a valid number');
  }

  return numeric;
};

const resolveSupplier = async (client, { supplierId, vendorName }) => {
  const normalizedVendor = normalizeText(vendorName);

  if (!supplierId && !normalizedVendor) {
    throw createHttpError(400, 'vendor is required');
  }

  if (supplierId) {
    await ensureSuppliersTable();
    const supplier = await getSupplierById(client, supplierId);
    if (!supplier) {
      throw createHttpError(404, `Supplier with id ${supplierId} was not found`);
    }
    return supplier;
  }

  return findOrCreateSupplierByName(client, normalizedVendor);
};

const canManageContracts = (req) =>
  Boolean(req.user?.hasPermission && req.user.hasPermission('contracts.manage'));

const toISODateString = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

const serializeContract = (row) => {
  if (!row) return null;

  const contractValue =
    row.contract_value === null || row.contract_value === undefined
      ? null
      : Number(row.contract_value);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const endDate = row.end_date ? new Date(row.end_date) : null;
  if (endDate && !Number.isNaN(endDate.getTime())) {
    endDate.setHours(0, 0, 0, 0);
  }

  const msInDay = 24 * 60 * 60 * 1000;
  const daysUntilExpiry =
    endDate && !Number.isNaN(endDate.getTime())
      ? Math.ceil((endDate.getTime() - now.getTime()) / msInDay)
      : null;

  const technicalDepartmentIds = normalizeIdArray(row.technical_department_ids);
  const endUserDepartmentIdValue = Number(row.end_user_department_id);
  const contractManagerIdValue = Number(row.contract_manager_id);
  const supplierIdValue = Number(row.supplier_id);
  const sourceRequestIdValue = Number(row.source_request_id);
  const endUserDepartmentId =
    Number.isInteger(endUserDepartmentIdValue) && endUserDepartmentIdValue > 0
      ? endUserDepartmentIdValue
      : null;
  const contractManagerId =
    Number.isInteger(contractManagerIdValue) && contractManagerIdValue > 0
      ? contractManagerIdValue
      : null;
  const supplierId =
    Number.isInteger(supplierIdValue) && supplierIdValue > 0 ? supplierIdValue : null;
  const sourceRequestId =
    Number.isInteger(sourceRequestIdValue) && sourceRequestIdValue > 0
      ? sourceRequestIdValue
      : null;

  return {
    id: row.id,
    title: row.title,
    vendor: row.vendor,
    supplier_id: supplierId,
    source_request_id: sourceRequestId,
    reference_number: row.reference_number,
    start_date: toISODateString(row.start_date),
    end_date: toISODateString(row.end_date),
    contract_value: Number.isNaN(contractValue) ? null : contractValue,
    status: row.status,
    description: row.description,
    delivery_terms: row.delivery_terms,
    warranty_terms: row.warranty_terms,
    performance_management: row.performance_management,
    end_user_department_id: endUserDepartmentId,
    contract_manager_id: contractManagerId,
    technical_department_ids: technicalDepartmentIds,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    days_until_expiry: daysUntilExpiry,
    is_expired: typeof daysUntilExpiry === 'number' ? daysUntilExpiry < 0 : false,
  };
};

const listContracts = async (req, res, next) => {
  try {
    await ensureContractsTable();

    const filters = [];
    const values = [];

    const requestedStatus = req.query.status;
    const search = normalizeText(req.query.search);

    if (requestedStatus && requestedStatus !== 'all') {
      const normalizedStatus = normalizeStatus(requestedStatus);
      if (!normalizedStatus) {
        return next(createHttpError(400, 'Invalid status filter'));
      }
      values.push(normalizedStatus);
      filters.push(`status = $${values.length}`);
    }

    if (search) {
      const searchTerm = `%${search.toLowerCase()}%`;
      const baseIndex = values.length;
      values.push(searchTerm, searchTerm, searchTerm);
      filters.push(
        `(LOWER(title) LIKE $${baseIndex + 1} OR LOWER(vendor) LIKE $${
          baseIndex + 2
        } OR LOWER(reference_number) LIKE $${baseIndex + 3})`
      );
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, title, vendor, supplier_id, source_request_id, reference_number, start_date, end_date,
              contract_value, status, description, delivery_terms, warranty_terms, performance_management,
              end_user_department_id, contract_manager_id, technical_department_ids,
              created_by, created_at, updated_at
         FROM contracts
         ${whereClause}
        ORDER BY updated_at DESC NULLS LAST, title ASC`,
      values
    );

    res.json(rows.map(serializeContract));
  } catch (err) {
    console.error('❌ Failed to list contracts:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to fetch contracts'));
  }
};

const getContractById = async (req, res, next) => {
  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  try {
    await ensureContractsTable();
    const { rows } = await pool.query(
      `SELECT id, title, vendor, supplier_id, source_request_id, reference_number, start_date, end_date,
              contract_value, status, description, delivery_terms, warranty_terms, performance_management,
              end_user_department_id, contract_manager_id, technical_department_ids,
              created_by, created_at, updated_at
         FROM contracts
        WHERE id = $1
        LIMIT 1`,
      [contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    res.json(serializeContract(rows[0]));
  } catch (err) {
    console.error('❌ Failed to fetch contract:', err);
    next(createHttpError(500, 'Failed to fetch contract'));
  }
};

const createContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to create contracts'));
  }

  const title = normalizeText(req.body?.title);
  const vendor = normalizeText(req.body?.vendor);
  const referenceNumber = normalizeText(req.body?.reference_number) || null;
  const description = normalizeText(req.body?.description) || null;
  const deliveryTerms = normalizeText(req.body?.delivery_terms) || null;
  const warrantyTerms = normalizeText(req.body?.warranty_terms) || null;
  const performanceManagement = normalizeText(req.body?.performance_management) || null;
  const rawStatus = req.body?.status || 'active';

  if (!title) {
    return next(createHttpError(400, 'title is required'));
  }
  if (!vendor) {
    return next(createHttpError(400, 'vendor is required'));
  }

  const status = normalizeStatus(rawStatus);
  if (!status) {
    return next(createHttpError(400, 'status is invalid'));
  }

  let startDate;
  let endDate;
  let contractValue;
  let endUserDepartmentId = null;
  let contractManagerId = null;
  let technicalDepartmentIds = [];
  let supplierId = null;
  let sourceRequestId = null;
  try {
    startDate = parseISODate(req.body?.start_date, 'start_date');
    endDate = parseISODate(req.body?.end_date, 'end_date');
    contractValue = parseContractValue(req.body?.contract_value);
    endUserDepartmentId = parseOptionalInteger(req.body?.end_user_department_id, 'end_user_department_id');
    contractManagerId = parseOptionalInteger(req.body?.contract_manager_id, 'contract_manager_id');
    technicalDepartmentIds = normalizeIdArray(req.body?.technical_department_ids);
    supplierId = parseOptionalInteger(req.body?.supplier_id, 'supplier_id');
    sourceRequestId = parseOptionalInteger(req.body?.source_request_id, 'source_request_id');
  } catch (err) {
    return next(err);
  }

  if (startDate && endDate && startDate > endDate) {
    return next(createHttpError(400, 'end_date must be after start_date'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureContractsTable();

    const supplier = await resolveSupplier(client, { supplierId, vendorName: vendor });
    await assertRequestExists(client, sourceRequestId);
    const { rows } = await client.query(
      `INSERT INTO contracts (
         title, vendor, supplier_id, source_request_id, reference_number, start_date, end_date, contract_value, status, description,
         delivery_terms, warranty_terms, performance_management, created_by,
         end_user_department_id, contract_manager_id, technical_department_ids
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, title, vendor, reference_number, start_date, end_date, contract_value, status, description,
                 delivery_terms, warranty_terms, performance_management,
                 supplier_id, source_request_id,
                 end_user_department_id, contract_manager_id, technical_department_ids,
                 created_by, created_at, updated_at`,
      [
        title,
        supplier.name,
        supplier.id,
        sourceRequestId,
        referenceNumber,
        startDate,
        endDate,
        contractValue,
        status,
        description,
        deliveryTerms,
        warrantyTerms,
        performanceManagement,
        req.user?.id || null,
        endUserDepartmentId,
        contractManagerId,
        toJsonbParameter(technicalDepartmentIds),
      ]
    );

    const contract = serializeContract(rows[0]);
    await ensureContractEvaluationsTable();
    const { rows: criteria } = await client.query('SELECT * FROM evaluation_criteria');
    for (const criterion of criteria) {
      const evaluators = await determineEvaluatorsForCriterion({ client, criterion, contract });
      if (!evaluators.length) {
        continue;
      }

      const evaluationTemplate = buildEvaluationTemplate(criterion);
      for (const evaluator of evaluators) {
        await client.query(
          `INSERT INTO contract_evaluations (
             contract_id,
             evaluator_id,
             evaluation_criteria,
             criterion_id,
             criterion_name,
             criterion_role,
             criterion_code
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contract.id,
            evaluator.id,
            evaluationTemplate,
            evaluationTemplate.criterionId,
            evaluationTemplate.criterionName,
            evaluationTemplate.criterionRole,
            evaluationTemplate.criterionCode,
          ]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(contract);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return next(createHttpError(409, 'A contract with this reference number already exists'));
    }
    console.error('❌ Failed to create contract:', err);
    next(createHttpError(500, 'Failed to create contract'));
  } finally {
    client.release();
  }
};

const updateContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to update contracts'));
  }

  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  let existing;
  const client = await pool.connect();

  try {
    await ensureContractsTable();
    const current = await client.query(
      `SELECT id, start_date, end_date, vendor, supplier_id, source_request_id
         FROM contracts
        WHERE id = $1
        LIMIT 1`,
      [contractId]
    );

    if (current.rowCount === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    existing = current.rows[0];

    const assignments = [];
    const values = [];

    const pushAssignment = (column, value) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    const title = req.body?.title !== undefined ? normalizeText(req.body.title) : undefined;
    const vendor = req.body?.vendor !== undefined ? normalizeText(req.body.vendor) : undefined;
    const referenceNumber =
      req.body?.reference_number !== undefined ? normalizeText(req.body.reference_number) || null : undefined;
    const description = req.body?.description !== undefined ? normalizeText(req.body.description) || null : undefined;
    const deliveryTerms =
      req.body?.delivery_terms !== undefined ? normalizeText(req.body.delivery_terms) || null : undefined;
    const warrantyTerms =
      req.body?.warranty_terms !== undefined ? normalizeText(req.body.warranty_terms) || null : undefined;
    const performanceManagement =
      req.body?.performance_management !== undefined ? normalizeText(req.body.performance_management) || null : undefined;

    if (title !== undefined) {
      if (!title) {
        return next(createHttpError(400, 'title is required'));
      }
      pushAssignment('title', title);
    }

    if (vendor !== undefined && !vendor) {
      return next(createHttpError(400, 'vendor is required'));
    }

    if (referenceNumber !== undefined) {
      pushAssignment('reference_number', referenceNumber);
    }

    if (description !== undefined) {
      pushAssignment('description', description);
    }

    if (deliveryTerms !== undefined) {
      pushAssignment('delivery_terms', deliveryTerms);
    }

    if (warrantyTerms !== undefined) {
      pushAssignment('warranty_terms', warrantyTerms);
    }

    if (performanceManagement !== undefined) {
      pushAssignment('performance_management', performanceManagement);
    }

    if (req.body?.end_user_department_id !== undefined) {
      const parsedDepartment = parseOptionalInteger(req.body.end_user_department_id, 'end_user_department_id');
      pushAssignment('end_user_department_id', parsedDepartment);
    }

    if (req.body?.contract_manager_id !== undefined) {
      const parsedManager = parseOptionalInteger(req.body.contract_manager_id, 'contract_manager_id');
      pushAssignment('contract_manager_id', parsedManager);
    }

    if (req.body?.technical_department_ids !== undefined) {
      const parsedDepartments = normalizeIdArray(req.body.technical_department_ids);
      pushAssignment('technical_department_ids', toJsonbParameter(parsedDepartments));
    }

    if (req.body?.status !== undefined) {
      const status = normalizeStatus(req.body.status);
      if (!status) {
        return next(createHttpError(400, 'status is invalid'));
      }
      pushAssignment('status', status);
    }

    let requestedStart;
    let startProvided = false;
    if (req.body?.start_date !== undefined) {
      requestedStart = parseISODate(req.body.start_date, 'start_date');
      startProvided = true;
      pushAssignment('start_date', requestedStart);
    }

    let requestedEnd;
    let endProvided = false;
    if (req.body?.end_date !== undefined) {
      requestedEnd = parseISODate(req.body.end_date, 'end_date');
      endProvided = true;
      pushAssignment('end_date', requestedEnd);
    }

    if (req.body?.contract_value !== undefined) {
      pushAssignment('contract_value', parseContractValue(req.body.contract_value));
    }

    let supplierId;
    let supplierProvided = false;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'supplier_id')) {
      supplierProvided = true;
      supplierId = parseOptionalInteger(req.body.supplier_id, 'supplier_id');
    }

    let sourceRequestId;
    let sourceRequestProvided = false;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'source_request_id')) {
      sourceRequestProvided = true;
      sourceRequestId = parseOptionalInteger(req.body.source_request_id, 'source_request_id');
    }

    await client.query('BEGIN');

    if (sourceRequestProvided) {
      await assertRequestExists(client, sourceRequestId);
      pushAssignment('source_request_id', sourceRequestId);
    }

    const needsSupplierResolution = supplierProvided || vendor !== undefined;
    if (needsSupplierResolution) {
      const supplier = await resolveSupplier(client, {
        supplierId: supplierProvided ? supplierId : null,
        vendorName: vendor !== undefined ? vendor : existing.vendor,
      });
      const vendorNameToPersist = vendor !== undefined ? vendor : supplier.name;
      pushAssignment('vendor', vendorNameToPersist);
      pushAssignment('supplier_id', supplier.id);
    }

    if (assignments.length === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'No valid fields provided for update'));
    }

    assignments.push('updated_at = NOW()');

    const currentStart = toISODateString(existing.start_date);
    const currentEnd = toISODateString(existing.end_date);
    const nextStart = startProvided ? requestedStart : currentStart;
    const nextEnd = endProvided ? requestedEnd : currentEnd;

    if (nextStart && nextEnd && nextStart > nextEnd) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'end_date must be after start_date'));
    }

    const { rows } = await client.query(
      `UPDATE contracts
          SET ${assignments.join(', ')}
        WHERE id = $${values.length + 1}
        RETURNING id, title, vendor, supplier_id, source_request_id, reference_number, start_date, end_date, contract_value, status, description,
                  delivery_terms, warranty_terms, performance_management,
                  end_user_department_id, contract_manager_id, technical_department_ids,
                  created_by, created_at, updated_at`,
      [...values, contractId]
    );

    await client.query('COMMIT');
    res.json(serializeContract(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') {
      return next(createHttpError(409, 'A contract with this reference number already exists'));
    }
    console.error('❌ Failed to update contract:', err);
    next(createHttpError(500, 'Failed to update contract'));
  } finally {
    client.release();
  }
};

const archiveContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to archive contracts'));
  }

  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  try {
    await ensureContractsTable();
    const { rows } = await pool.query(
      `UPDATE contracts
          SET status = 'archived', updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, vendor, supplier_id, source_request_id, reference_number, start_date, end_date, contract_value, status, description,
                  created_by, created_at, updated_at`,
      [contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    res.json(serializeContract(rows[0]));
  } catch (err) {
    console.error('❌ Failed to archive contract:', err);
    next(createHttpError(500, 'Failed to archive contract'));
  }
};

const {
  ensureAttachmentsContractIdColumn,
  attachmentsHasContractIdColumn,
  insertAttachment,
} = require('../utils/attachmentSchema');
const { storeAttachmentFile } = require('../utils/attachmentStorage');
const { serializeAttachment } = require('../utils/attachmentPaths');

const getContractAttachments = async (req, res, next) => {
  const { contractId } = req.params;

  try {
    await ensureAttachmentsContractIdColumn(pool);

    const supportsContractAttachments = await attachmentsHasContractIdColumn(pool);
    if (!supportsContractAttachments) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT id, file_name, file_path, uploaded_by, uploaded_at
       FROM attachments
       WHERE contract_id = $1`,
      [contractId]
    );

    res.json(result.rows.map(serializeAttachment));
  } catch (err) {
    console.error('❌ Failed to fetch attachments:', err.message);
    next(createHttpError(500, 'Failed to fetch attachments'));
  }
};

const uploadContractAttachment = async (req, res, next) => {
  const { contractId } = req.params;
  const file = req.file;

  if (!file) return next(createHttpError(400, 'No file uploaded'));

  try {
    await ensureAttachmentsContractIdColumn(pool);

    const supportsContractAttachments = await attachmentsHasContractIdColumn(pool);
    if (!supportsContractAttachments) {
      return next(
        createHttpError(
          400,
          'Contract-level attachments are not supported by the current database schema'
        )
      );
    }

    const { objectKey } = await storeAttachmentFile({
      file,
      requestId: null,
      itemId: null,
      contractId,
    });

    const saved = await insertAttachment(pool, {
      requestId: null,
      itemId: null,
      contractId,
      fileName: file.originalname,
      filePath: objectKey,
      uploadedBy: req.user.id,
    });

    res.status(201).json({
      message: '📎 File uploaded successfully',
      attachmentId: saved.rows[0].id
    });
  } catch (err) {
    console.error('❌ Upload error:', err.message);
    if (err.code === 'SUPABASE_NOT_CONFIGURED') {
      return next(
        createHttpError(
          500,
          'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        )
      );
    }

    return next(createHttpError(500, 'Failed to upload attachment'));
  }
};

module.exports = {
  listContracts,
  getContractById,
  createContract,
  updateContract,
  archiveContract,
  CONTRACT_STATUSES,
  getContractAttachments,
  uploadContractAttachment,
  getEvaluationCandidates,
};
