const fs = require('fs/promises');
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureContractEvaluationsTable } = require('./contractEvaluationsController');
const { ensureEvaluationCriteriaTable } = require('../utils/evaluationCriteriaSeeder');
const {
  ensureSuppliersTable,
  findOrCreateSupplierByName,
  getSupplierById,
} = require('./suppliersController');
const { getComplianceStatusBySupplierIds } = require('./supplierSrmController');
const { resolveStoredLocalPath, isStoredLocally } = require('../utils/attachmentPaths');
const { removeObject } = require('../utils/storage');

const CONTRACT_STATUSES = [
  'draft',
  'under_review',
  'legal_review',
  'technical_review',
  'finance_review',
  'executive_approval',
  'sent_for_signature',
  'active',
  'expiring_soon',
  'renewed',
  'expired',
  'terminated',
  'archived',
];
const LEGACY_STATUS_MAP = {
  'legal-review': 'legal_review',
  'technical-review': 'technical_review',
  'finance-review': 'finance_review',
  signed: 'active',
  pending_review: 'under_review',
  approved: 'active',
  inactive: 'archived',
  cancelled: 'terminated',
  completed: 'expired',
  pending_signature: 'sent_for_signature',
  expiring: 'expiring_soon',
  'on-hold': 'under_review',
  'scm-review': 'under_review',
  'ceo-coo-approval': 'executive_approval',
};

const CONTRACT_STATUS_TRANSITIONS = {
  draft: new Set(['under_review', 'archived']),
  under_review: new Set(['legal_review', 'technical_review', 'finance_review', 'executive_approval', 'draft', 'terminated']),
  legal_review: new Set(['technical_review', 'finance_review', 'executive_approval', 'under_review', 'terminated']),
  technical_review: new Set(['finance_review', 'executive_approval', 'under_review', 'terminated']),
  finance_review: new Set(['executive_approval', 'sent_for_signature', 'under_review', 'terminated']),
  executive_approval: new Set(['sent_for_signature', 'active', 'under_review', 'terminated']),
  sent_for_signature: new Set(['active', 'under_review', 'terminated']),
  active: new Set(['expiring_soon', 'renewed', 'expired', 'terminated', 'archived']),
  expiring_soon: new Set(['renewed', 'expired', 'terminated', 'active']),
  renewed: new Set(['active', 'expiring_soon', 'archived']),
  expired: new Set(['renewed', 'archived']),
  terminated: new Set(['archived']),
  archived: new Set(),
};


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


const CLM_ADDITIONAL_PAYLOAD_KEYS = [
  'commercial_contract_value','commercial_unit_pricing','commercial_price_validity','commercial_discount_structure','commercial_vat_tax','commercial_currency_exchange_clause','commercial_escalation_clause','commercial_minimum_order_quantity','commercial_delivery_charges','delivery_location_department_id','delivery_incoterms','delivery_lead_time_days','delivery_emergency_terms','delivery_shipping_responsibility','delivery_customs_clearance_responsibility','delivery_packaging_requirements','delivery_transportation_requirements','delivery_partial_allowed','sla_response_time','sla_resolution_time','sla_uptime_requirement','sla_preventive_maintenance_frequency','sla_emergency_support_availability','sla_spare_parts_availability','sla_escalation_path_user','payment_methods','payment_period','payment_advance_percentage','payment_retention','payment_milestone_details','payment_invoice_requirements','payment_partial_allowed','payment_penalty_rate_percent','payment_penalty_timeline','payment_penalty_max_percent',
];

const extractAdditionalClmPayload = (payload = {}) => {
  const additional = {};
  for (const key of CLM_ADDITIONAL_PAYLOAD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) additional[key] = payload[key];
  }
  return additional;
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
    await ensureContractsPhaseTwoTables();
    client = await pool.connect();

    const contractResult = await client.query(
      `SELECT id, title, vendor, reference_number, start_date, signing_date, end_date, contract_value, amount_paid, status, description,
              delivery_terms, warranty_terms, performance_management,
              commercial_terms, compliance_legal_terms, financial_payment_control, risk_dispute_management, digital_attachments_tracking,
              institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
              estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
              vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
              scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
              payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
              change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
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
  let amountPaidColumnEnsured = false;
  let signingDateColumnEnsured = false;
  let contractSectionsColumnsEnsured = false;
  let ensuringPromise = null;

  const ensureTableStructure = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        vendor TEXT NOT NULL,
        reference_number TEXT,
        start_date DATE,
        signing_date DATE,
        end_date DATE,
        contract_value NUMERIC(14, 2),
        amount_paid NUMERIC(14, 2) DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        description TEXT,
        delivery_terms TEXT,
        warranty_terms TEXT,
        performance_management TEXT,
        commercial_terms TEXT,
        compliance_legal_terms TEXT,
        financial_payment_control TEXT,
        risk_dispute_management TEXT,
        digital_attachments_tracking TEXT,
        institute TEXT,
        contract_category TEXT,
        renewal_type TEXT,
        renewal_notice_days INTEGER,
        contract_owner TEXT,
        currency TEXT,
        estimated_contract_value NUMERIC(14,2),
        actual_consumed_value NUMERIC(14,2),
        first_party TEXT,
        second_party TEXT,
        authorized_signatory TEXT,
        vendor_contact_person TEXT,
        vendor_contact_email TEXT,
        vendor_contact_phone TEXT,
        vendor_tax_id TEXT,
        vendor_address TEXT,
        scope_summary TEXT,
        deliverables TEXT,
        technical_specifications TEXT,
        service_coverage TEXT,
        exclusions TEXT,
        sla_requirements TEXT,
        payment_terms_details TEXT,
        delivery_logistics_details TEXT,
        sla_details TEXT,
        penalties_incentives TEXT,
        change_management_terms TEXT,
        termination_exit_terms TEXT,
        alert_rules TEXT,
        supplier_id INTEGER,
        source_request_id INTEGER,
        end_user_department_id INTEGER,
        contract_manager_id INTEGER,
        technical_department_ids JSONB,
        clm_additional_payload JSONB,
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

  const ensureSigningDateColumn = async () => {
    if (signingDateColumnEnsured) {
      return;
    }

    await pool.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS signing_date DATE
    `);

    signingDateColumnEnsured = true;
  };

  const ensureAmountPaidColumn = async () => {
    if (amountPaidColumnEnsured) {
      return;
    }

    try {
      await pool.query(`
        ALTER TABLE contracts
          ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14, 2) DEFAULT 0
      `);
      amountPaidColumnEnsured = true;
    } catch (err) {
      if (err?.code === '42P01') {
        console.warn('⚠️ Contracts table missing; will retry ensuring amount_paid column later.');
      } else {
        throw err;
      }
    }
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

  const ensureContractSectionColumns = async () => {
    if (contractSectionsColumnsEnsured) {
      return;
    }

    await pool.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS commercial_terms TEXT,
        ADD COLUMN IF NOT EXISTS compliance_legal_terms TEXT,
        ADD COLUMN IF NOT EXISTS financial_payment_control TEXT,
        ADD COLUMN IF NOT EXISTS risk_dispute_management TEXT,
        ADD COLUMN IF NOT EXISTS digital_attachments_tracking TEXT,
        ADD COLUMN IF NOT EXISTS institute TEXT,
        ADD COLUMN IF NOT EXISTS contract_category TEXT,
        ADD COLUMN IF NOT EXISTS renewal_type TEXT,
        ADD COLUMN IF NOT EXISTS renewal_notice_days INTEGER,
        ADD COLUMN IF NOT EXISTS contract_owner TEXT,
        ADD COLUMN IF NOT EXISTS currency TEXT,
        ADD COLUMN IF NOT EXISTS estimated_contract_value NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS actual_consumed_value NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS first_party TEXT,
        ADD COLUMN IF NOT EXISTS second_party TEXT,
        ADD COLUMN IF NOT EXISTS authorized_signatory TEXT,
        ADD COLUMN IF NOT EXISTS vendor_contact_person TEXT,
        ADD COLUMN IF NOT EXISTS vendor_contact_email TEXT,
        ADD COLUMN IF NOT EXISTS vendor_contact_phone TEXT,
        ADD COLUMN IF NOT EXISTS vendor_tax_id TEXT,
        ADD COLUMN IF NOT EXISTS vendor_address TEXT,
        ADD COLUMN IF NOT EXISTS scope_summary TEXT,
        ADD COLUMN IF NOT EXISTS deliverables TEXT,
        ADD COLUMN IF NOT EXISTS technical_specifications TEXT,
        ADD COLUMN IF NOT EXISTS service_coverage TEXT,
        ADD COLUMN IF NOT EXISTS exclusions TEXT,
        ADD COLUMN IF NOT EXISTS sla_requirements TEXT,
        ADD COLUMN IF NOT EXISTS payment_terms_details TEXT,
        ADD COLUMN IF NOT EXISTS delivery_logistics_details TEXT,
        ADD COLUMN IF NOT EXISTS sla_details TEXT,
        ADD COLUMN IF NOT EXISTS penalties_incentives TEXT,
        ADD COLUMN IF NOT EXISTS change_management_terms TEXT,
        ADD COLUMN IF NOT EXISTS termination_exit_terms TEXT,
        ADD COLUMN IF NOT EXISTS alert_rules TEXT
    `);

    await pool.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS clm_additional_payload JSONB
    `);

    contractSectionsColumnsEnsured = true;
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
      amountPaidColumnEnsured &&
      signingDateColumnEnsured &&
      contractSectionsColumnsEnsured &&
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

          if (!amountPaidColumnEnsured) {
            await ensureAmountPaidColumn();
          }

          if (!signingDateColumnEnsured) {
            await ensureSigningDateColumn();
          }

          if (!linkageColumnsEnsured) {
            await ensureLinkageColumns();
          }

          if (!contractSectionsColumnsEnsured) {
            await ensureContractSectionColumns();
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

const ensureContractsPhaseTwoTables = (() => {
  let ensured = false;
  let ensuringPromise = null;

  return async () => {
    if (ensured) return;
    if (!ensuringPromise) {
      ensuringPromise = (async () => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contract_amendments (
            id SERIAL PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            amendment_number INTEGER NOT NULL,
            amendment_date DATE,
            change_summary TEXT,
            revised_value NUMERIC(14,2),
            revised_expiry DATE,
            approved_by INTEGER,
            snapshot JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contract_alerts (
            id SERIAL PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            alert_type TEXT NOT NULL,
            threshold_value TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            last_triggered_at TIMESTAMPTZ,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contract_approvals (
            id SERIAL PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            workflow_level INTEGER NOT NULL DEFAULT 1,
            is_active_level BOOLEAN NOT NULL DEFAULT FALSE,
            stage TEXT NOT NULL,
            reviewer_role TEXT,
            reviewer_id INTEGER,
            decision TEXT,
            comments TEXT,
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            decided_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS workflow_level INTEGER NOT NULL DEFAULT 1`);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS is_active_level BOOLEAN NOT NULL DEFAULT FALSE`);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS reviewer_role TEXT`);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS approval_level INTEGER NOT NULL DEFAULT 1`);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending'`);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE`);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pool.query(`ALTER TABLE contract_approvals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contract_items (
            id SERIAL PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            item_id INTEGER,
            item_name TEXT NOT NULL,
            generic_name TEXT,
            brand_name TEXT,
            unit TEXT,
            contracted_price NUMERIC(14,2),
            currency TEXT,
            minimum_order_quantity NUMERIC(14,2),
            lead_time_days INTEGER,
            warranty_terms TEXT,
            price_valid_from DATE,
            price_valid_to DATE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contract_required_documents (
            id SERIAL PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            document_type TEXT NOT NULL,
            is_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
            attachment_id INTEGER,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(contract_id, document_type)
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS contract_logs (
            id SERIAL PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            action TEXT NOT NULL,
            actor_id INTEGER,
            details JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query(`CREATE SEQUENCE IF NOT EXISTS contract_logs_id_seq`);
        await pool.query(`ALTER SEQUENCE contract_logs_id_seq OWNED BY contract_logs.id`);
        await pool.query(`ALTER TABLE contract_logs ALTER COLUMN id SET DEFAULT nextval('contract_logs_id_seq'::regclass)`);
        await pool.query(`SELECT setval('contract_logs_id_seq', COALESCE((SELECT MAX(id) FROM contract_logs), 0) + 1, false)`);
        ensured = true;
      })().finally(() => {
        ensuringPromise = null;
      });
    }
    await ensuringPromise;
  };
})();

const CONTRACT_DOCUMENT_TYPES = ['draft', 'signed_contract', 'amendment', 'invoice', 'supporting_document', 'legal_review', 'technical_attachment', 'financial_attachment', 'other'];
const CONTRACT_DOCUMENT_STATUSES = ['active', 'superseded', 'archived'];
const ensureContractsPhaseThreeTables = (() => {
  let ensured = false;
  let ensuringPromise = null;
  return async () => {
    if (ensured) return;
    if (!ensuringPromise) {
      ensuringPromise = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS contract_documents (
          id BIGSERIAL PRIMARY KEY,
          contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          document_type TEXT NOT NULL,
          title TEXT,
          description TEXT,
          current_version_id BIGINT,
          status TEXT NOT NULL DEFAULT 'active',
          created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT contract_documents_document_type_check CHECK (document_type = ANY(ARRAY['draft','signed_contract','amendment','invoice','supporting_document','legal_review','technical_attachment','financial_attachment','other'])),
          CONSTRAINT contract_documents_status_check CHECK (status = ANY(ARRAY['active','superseded','archived']))
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS contract_document_versions (
          id BIGSERIAL PRIMARY KEY,
          document_id BIGINT NOT NULL REFERENCES contract_documents(id) ON DELETE CASCADE,
          contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          file_name TEXT, file_url TEXT, storage_path TEXT, mime_type TEXT,
          file_size BIGINT, checksum TEXT, uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          is_current BOOLEAN NOT NULL DEFAULT FALSE,
          notes TEXT,
          UNIQUE(document_id, version_number)
        )`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS contract_document_versions_one_current_idx ON contract_document_versions(document_id) WHERE is_current = TRUE`);
        await pool.query(`CREATE INDEX IF NOT EXISTS contract_documents_contract_id_idx ON contract_documents(contract_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS contract_documents_document_type_idx ON contract_documents(document_type)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS contract_document_versions_contract_id_idx ON contract_document_versions(contract_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS contract_document_versions_document_id_idx ON contract_document_versions(document_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS contract_document_versions_uploaded_at_idx ON contract_document_versions(uploaded_at DESC)`);
        await pool.query(`ALTER TABLE contract_documents DROP CONSTRAINT IF EXISTS contract_documents_current_version_id_fkey`);
        await pool.query(`ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES contract_document_versions(id) ON DELETE SET NULL`);
        ensured = true;
      })().finally(() => { ensuringPromise = null; });
    }
    await ensuringPromise;
  };
})();
const OBLIGATION_TYPES = ['general','payment','delivery','reporting','compliance','maintenance','warranty','sla','renewal','termination','documentation','other'];
const OBLIGATION_RECURRENCES = ['none','daily','weekly','monthly','quarterly','semiannual','annual','custom'];
const OBLIGATION_PRIORITIES = ['low','medium','high','critical'];
const OBLIGATION_STATUSES = ['open','in_progress','completed','overdue','waived','cancelled'];
const RENEWAL_STATUSES = ['pending','alerted','under_review','renewed','not_renewed','cancelled','completed'];
const RENEWAL_DECISIONS = ['renew','do_not_renew','renegotiate','terminate','extend_temporarily'];
const ensureContractsPhaseFourTables = (() => {
  let ensured = false; let ensuringPromise = null;
  return async () => {
    if (ensured) return;
    if (!ensuringPromise) ensuringPromise = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS contract_obligations (
        id BIGSERIAL PRIMARY KEY, contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT,
        obligation_type TEXT NOT NULL DEFAULT 'general', owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, owner_department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
        due_date DATE, recurrence TEXT NOT NULL DEFAULT 'none', recurrence_interval INTEGER, next_due_date DATE, evidence_required BOOLEAN NOT NULL DEFAULT FALSE, evidence_document_id BIGINT REFERENCES contract_documents(id) ON DELETE SET NULL,
        priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open', completion_notes TEXT, completed_at TIMESTAMPTZ, completed_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT contract_obligations_type_check CHECK (obligation_type = ANY(ARRAY['general','payment','delivery','reporting','compliance','maintenance','warranty','sla','renewal','termination','documentation','other'])),
        CONSTRAINT contract_obligations_recurrence_check CHECK (recurrence = ANY(ARRAY['none','daily','weekly','monthly','quarterly','semiannual','annual','custom'])),
        CONSTRAINT contract_obligations_priority_check CHECK (priority = ANY(ARRAY['low','medium','high','critical'])),
        CONSTRAINT contract_obligations_status_check CHECK (status = ANY(ARRAY['open','in_progress','completed','overdue','waived','cancelled']))
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS contract_renewal_events (
        id BIGSERIAL PRIMARY KEY, contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, renewal_type TEXT, renewal_date DATE, notice_days INTEGER NOT NULL DEFAULT 90, alert_date DATE,
        status TEXT NOT NULL DEFAULT 'pending', decision TEXT, decision_notes TEXT, decided_by BIGINT REFERENCES users(id) ON DELETE SET NULL, decided_at TIMESTAMPTZ, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT contract_renewal_events_status_check CHECK (status = ANY(ARRAY['pending','alerted','under_review','renewed','not_renewed','cancelled','completed'])),
        CONSTRAINT contract_renewal_events_decision_check CHECK (decision IS NULL OR decision = ANY(ARRAY['renew','do_not_renew','renegotiate','terminate','extend_temporarily']))
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_obligations_contract_id_idx ON contract_obligations(contract_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_obligations_owner_user_id_idx ON contract_obligations(owner_user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_obligations_due_date_idx ON contract_obligations(due_date)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_obligations_status_idx ON contract_obligations(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_obligations_next_due_date_idx ON contract_obligations(next_due_date)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_renewal_events_contract_id_idx ON contract_renewal_events(contract_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_renewal_events_alert_date_idx ON contract_renewal_events(alert_date)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_renewal_events_renewal_date_idx ON contract_renewal_events(renewal_date)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS contract_renewal_events_status_idx ON contract_renewal_events(status)`);
      ensured = true;
    })().finally(()=>{ensuringPromise=null;});
    await ensuringPromise;
  };
})();

const recordContractLog = async (client, { contractId, action, actorId = null, details = null }) => {
  const values = [contractId, action, actorId, details ? JSON.stringify(details) : null];
  try {
    await client.query(
      `INSERT INTO contract_logs (contract_id, action, actor_id, details)
       VALUES ($1, $2, $3, $4)`,
      values
    );
  } catch (err) {
    const isDuplicatePrimaryKey = err?.code === '23505' && err?.constraint === 'contract_logs_pkey';
    if (!isDuplicatePrimaryKey) {
      throw err;
    }

    await client.query(`SELECT setval('contract_logs_id_seq', COALESCE((SELECT MAX(id) FROM contract_logs), 0) + 1, false)`);
    await client.query(
      `INSERT INTO contract_logs (contract_id, action, actor_id, details)
       VALUES ($1, $2, $3, $4)`,
      values
    );
  }
};

const normalizeStatus = (value) => {
  const raw = normalizeText(value).toLowerCase();
  const status = LEGACY_STATUS_MAP[raw] || raw;
  return CONTRACT_STATUSES.includes(status) ? status : null;
};


const computeExpiringSoonStatus = ({ status, startDate, endDate, renewalNoticeDays }) => {
  if (!endDate) return status;
  if (['terminated', 'archived', 'expired', 'renewed'].includes(status)) return status;
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(endDate); end.setHours(0,0,0,0);
  if (Number.isNaN(end.getTime())) return status;
  if (end < today) return 'expired';
  const noticeDays = Number.isFinite(Number(renewalNoticeDays)) && Number(renewalNoticeDays) > 0 ? Number(renewalNoticeDays) : 90;
  const days = Math.ceil((end.getTime()-today.getTime())/86400000);
  if (days <= noticeDays) return 'expiring_soon';
  if (status === 'expiring_soon') return 'active';
  return status;
};

const ensureValidStatusTransition = ({ currentStatus, nextStatus, allowArchivedSource = false }) => {
  const normalizedCurrent = normalizeStatus(currentStatus) || 'draft';
  const normalizedNext = normalizeStatus(nextStatus);
  if (!normalizedNext) throw createHttpError(400, 'status is invalid');
  if (normalizedCurrent === normalizedNext) return normalizedNext;
  if (normalizedCurrent === 'archived' && allowArchivedSource) return normalizedNext;
  const allowed = CONTRACT_STATUS_TRANSITIONS[normalizedCurrent] || new Set();
  if (!allowed.has(normalizedNext)) {
    throw createHttpError(400, `Invalid status transition from ${normalizedCurrent} to ${normalizedNext}`);
  }
  return normalizedNext;
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

const parseAmountPaid = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    throw createHttpError(400, 'amount_paid must be a valid number');
  }

  if (numeric < 0) {
    throw createHttpError(400, 'amount_paid cannot be negative');
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

const serializeContract = (row, compliance = null) => {
  if (!row) return null;

  const contractValue =
    row.contract_value === null || row.contract_value === undefined
      ? null
      : Number(row.contract_value);

  const amountPaidValue =
    row.amount_paid === null || row.amount_paid === undefined ? null : Number(row.amount_paid);

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

  const paidPercentage =
    typeof contractValue === 'number' && Number.isFinite(contractValue) && contractValue > 0 &&
    typeof amountPaidValue === 'number' && Number.isFinite(amountPaidValue)
      ? Number(Math.min((amountPaidValue / contractValue) * 100, 9999).toFixed(2))
      : null;
  const clmAdditionalPayload = parseJson(row.clm_additional_payload) || {};

  return {
    id: row.id,
    title: row.title,
    vendor: row.vendor,
    supplier_id: supplierId,
    source_request_id: sourceRequestId,
    reference_number: row.reference_number,
    start_date: toISODateString(row.start_date),
    signing_date: toISODateString(row.signing_date),
    end_date: toISODateString(row.end_date),
    contract_value: Number.isNaN(contractValue) ? null : contractValue,
    amount_paid: Number.isNaN(amountPaidValue) ? null : amountPaidValue,
    paid_percentage: paidPercentage,
    status: row.status,
    description: row.description,
    delivery_terms: row.delivery_terms,
    warranty_terms: row.warranty_terms,
    performance_management: row.performance_management,
    commercial_terms: row.commercial_terms,
    compliance_legal_terms: row.compliance_legal_terms,
    financial_payment_control: row.financial_payment_control,
    risk_dispute_management: row.risk_dispute_management,
    digital_attachments_tracking: row.digital_attachments_tracking,
    institute: row.institute,
    contract_category: row.contract_category,
    renewal_type: row.renewal_type,
    renewal_notice_days: row.renewal_notice_days,
    contract_owner: row.contract_owner,
    currency: row.currency,
    estimated_contract_value: row.estimated_contract_value === null ? null : Number(row.estimated_contract_value),
    actual_consumed_value: row.actual_consumed_value === null ? null : Number(row.actual_consumed_value),
    remaining_balance:
      row.estimated_contract_value === null || row.actual_consumed_value === null
        ? null
        : Number(row.estimated_contract_value) - Number(row.actual_consumed_value),
    first_party: row.first_party,
    second_party: row.second_party,
    authorized_signatory: row.authorized_signatory,
    vendor_contact_person: row.vendor_contact_person,
    vendor_contact_email: row.vendor_contact_email,
    vendor_contact_phone: row.vendor_contact_phone,
    vendor_tax_id: row.vendor_tax_id,
    vendor_address: row.vendor_address,
    scope_summary: row.scope_summary,
    deliverables: row.deliverables,
    technical_specifications: row.technical_specifications,
    service_coverage: row.service_coverage,
    exclusions: row.exclusions,
    sla_requirements: row.sla_requirements,
    payment_terms_details: row.payment_terms_details,
    delivery_logistics_details: row.delivery_logistics_details,
    sla_details: row.sla_details,
    penalties_incentives: row.penalties_incentives,
    change_management_terms: row.change_management_terms,
    termination_exit_terms: row.termination_exit_terms,
    alert_rules: row.alert_rules,
    clm_additional_payload: clmAdditionalPayload,
    ...clmAdditionalPayload,
    end_user_department_id: endUserDepartmentId,
    contract_manager_id: contractManagerId,
    technical_department_ids: technicalDepartmentIds,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    days_until_expiry: daysUntilExpiry,
    is_expired: typeof daysUntilExpiry === 'number' ? daysUntilExpiry < 0 : false,
    supplier_compliance: compliance,
  };
};

const listContracts = async (req, res, next) => {
  try {
    await ensureContractsTable();
    await ensureContractsPhaseTwoTables();

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
      `SELECT id, title, vendor, supplier_id, source_request_id, reference_number, start_date, signing_date, end_date,
              contract_value, amount_paid, status, description, delivery_terms, warranty_terms, performance_management,
              commercial_terms, compliance_legal_terms, financial_payment_control, risk_dispute_management, digital_attachments_tracking,
              institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
              estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
              vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
              scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
              payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
              change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
              end_user_department_id, contract_manager_id, technical_department_ids,
              created_by, created_at, updated_at
         FROM contracts
         ${whereClause}
        ORDER BY updated_at DESC NULLS LAST, title ASC`,
      values
    );

    const supplierIds = Array.from(
      new Set(
        rows
          .map(row => Number(row.supplier_id))
          .filter(value => Number.isInteger(value) && value > 0)
      )
    );
    const complianceMap = await getComplianceStatusBySupplierIds(supplierIds);

    res.json(
      rows.map(row => serializeContract(row, complianceMap.get(row.supplier_id) || null))
    );
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
      `SELECT id, title, vendor, supplier_id, source_request_id, reference_number, start_date, signing_date, end_date,
              contract_value, amount_paid, status, description, delivery_terms, warranty_terms, performance_management,
              commercial_terms, compliance_legal_terms, financial_payment_control, risk_dispute_management, digital_attachments_tracking,
              institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
              estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
              vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
              scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
              payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
              change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
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
    await pool.query(
      `INSERT INTO contract_logs (contract_id, action, actor_id, details) VALUES ($1,$2,$3,$4)`,
      [contractId, 'contract_viewed', req.user?.id || null, null]
    );

    const complianceMap = await getComplianceStatusBySupplierIds([rows[0].supplier_id]);
    res.json(serializeContract(rows[0], complianceMap.get(rows[0].supplier_id) || null));
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
  const commercialTerms = normalizeText(req.body?.commercial_terms) || null;
  const complianceLegalTerms = normalizeText(req.body?.compliance_legal_terms) || null;
  const financialPaymentControl = normalizeText(req.body?.financial_payment_control) || null;
  const riskDisputeManagement = normalizeText(req.body?.risk_dispute_management) || null;
  const digitalAttachmentsTracking = normalizeText(req.body?.digital_attachments_tracking) || null;
  const institute = normalizeText(req.body?.institute) || null;
  const contractCategory = normalizeText(req.body?.contract_category) || null;
  const renewalType = normalizeText(req.body?.renewal_type) || null;
  const contractOwner = normalizeText(req.body?.contract_owner) || null;
  const currency = normalizeText(req.body?.currency) || null;
  const firstParty = normalizeText(req.body?.first_party) || null;
  const secondParty = normalizeText(req.body?.second_party) || null;
  const authorizedSignatory = normalizeText(req.body?.authorized_signatory) || null;
  const vendorContactPerson = normalizeText(req.body?.vendor_contact_person) || null;
  const vendorContactEmail = normalizeText(req.body?.vendor_contact_email) || null;
  const vendorContactPhone = normalizeText(req.body?.vendor_contact_phone) || null;
  const vendorTaxId = normalizeText(req.body?.vendor_tax_id) || null;
  const vendorAddress = normalizeText(req.body?.vendor_address) || null;
  const scopeSummary = normalizeText(req.body?.scope_summary) || null;
  const deliverables = normalizeText(req.body?.deliverables) || null;
  const technicalSpecifications = normalizeText(req.body?.technical_specifications) || null;
  const serviceCoverage = normalizeText(req.body?.service_coverage) || null;
  const exclusions = normalizeText(req.body?.exclusions) || null;
  const slaRequirements = normalizeText(req.body?.sla_requirements) || null;
  const paymentTermsDetails = normalizeText(req.body?.payment_terms_details) || null;
  const deliveryLogisticsDetails = normalizeText(req.body?.delivery_logistics_details) || null;
  const slaDetails = normalizeText(req.body?.sla_details) || null;
  const penaltiesIncentives = normalizeText(req.body?.penalties_incentives) || null;
  const changeManagementTerms = normalizeText(req.body?.change_management_terms) || null;
  const terminationExitTerms = normalizeText(req.body?.termination_exit_terms) || null;
  const alertRules = normalizeText(req.body?.alert_rules) || null;
  const clmAdditionalPayload = extractAdditionalClmPayload(req.body || {});
  const rawStatus = req.body?.status || 'draft';

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
  let signingDate;
  let endDate;
  let contractValue;
  let amountPaid;
  let endUserDepartmentId = null;
  let contractManagerId = null;
  let technicalDepartmentIds = [];
  let supplierId = null;
  let sourceRequestId = null;
  let renewalNoticeDays = null;
  let estimatedContractValue = null;
  let actualConsumedValue = null;
  try {
    startDate = parseISODate(req.body?.start_date, 'start_date');
    signingDate = parseISODate(req.body?.signing_date, 'signing_date');
    endDate = parseISODate(req.body?.end_date, 'end_date');
    contractValue = parseContractValue(req.body?.contract_value);
    amountPaid = parseAmountPaid(req.body?.amount_paid);
    endUserDepartmentId = parseOptionalInteger(req.body?.end_user_department_id, 'end_user_department_id');
    contractManagerId = parseOptionalInteger(req.body?.contract_manager_id, 'contract_manager_id');
    technicalDepartmentIds = normalizeIdArray(req.body?.technical_department_ids);
    supplierId = parseOptionalInteger(req.body?.supplier_id, 'supplier_id');
    sourceRequestId = parseOptionalInteger(req.body?.source_request_id, 'source_request_id');
    renewalNoticeDays = parseOptionalInteger(req.body?.renewal_notice_days, 'renewal_notice_days');
    estimatedContractValue = parseContractValue(req.body?.estimated_contract_value);
    actualConsumedValue = parseContractValue(req.body?.actual_consumed_value);

    if (
      typeof contractValue === 'number' &&
      contractValue !== null &&
      typeof amountPaid === 'number' &&
      amountPaid !== null &&
      amountPaid > contractValue
    ) {
      throw createHttpError(400, 'amount_paid cannot exceed contract_value');
    }
  } catch (err) {
    return next(err);
  }

  if (startDate && endDate && startDate > endDate) {
    return next(createHttpError(400, 'end_date must be after start_date'));
  }

  if (signingDate && startDate && signingDate > startDate) {
    return next(createHttpError(400, 'signing_date must be on or before start_date'));
  }

  if (signingDate && endDate && signingDate > endDate) {
    return next(createHttpError(400, 'signing_date must be on or before end_date'));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureContractsTable();
    await ensureContractsPhaseTwoTables();

    const supplier = await resolveSupplier(client, { supplierId, vendorName: vendor });
    await assertRequestExists(client, sourceRequestId);
    const { rows } = await client.query(
      `INSERT INTO contracts (
         title, vendor, supplier_id, source_request_id, reference_number, start_date, signing_date, end_date, contract_value, amount_paid, status, description,
         delivery_terms, warranty_terms, performance_management, commercial_terms, compliance_legal_terms,
         financial_payment_control, risk_dispute_management, digital_attachments_tracking,
         institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
         estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
         vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
         scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
         payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
         change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
         created_by, end_user_department_id, contract_manager_id, technical_department_ids
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54)
       RETURNING id, title, vendor, reference_number, start_date, signing_date, end_date, contract_value, amount_paid, status, description,
                 delivery_terms, warranty_terms, performance_management, commercial_terms, compliance_legal_terms,
                 financial_payment_control, risk_dispute_management, digital_attachments_tracking,
                 institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
                 estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
                 vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
                 scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
                 payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
                 change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
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
        signingDate,
        endDate,
        contractValue,
        amountPaid,
        status,
        description,
        deliveryTerms,
        warrantyTerms,
        performanceManagement,
        commercialTerms,
        complianceLegalTerms,
        financialPaymentControl,
        riskDisputeManagement,
        digitalAttachmentsTracking,
        institute,
        contractCategory,
        renewalType,
        renewalNoticeDays,
        contractOwner,
        currency,
        estimatedContractValue,
        actualConsumedValue,
        firstParty,
        secondParty,
        authorizedSignatory,
        vendorContactPerson,
        vendorContactEmail,
        vendorContactPhone,
        vendorTaxId,
        vendorAddress,
        scopeSummary,
        deliverables,
        technicalSpecifications,
        serviceCoverage,
        exclusions,
        slaRequirements,
        paymentTermsDetails,
        deliveryLogisticsDetails,
        slaDetails,
        penaltiesIncentives,
        changeManagementTerms,
        terminationExitTerms,
        alertRules,
        toJsonbParameter(clmAdditionalPayload),
        req.user?.id || null,
        endUserDepartmentId,
        contractManagerId,
        toJsonbParameter(technicalDepartmentIds),
      ]
    );

    let supplierCompliance = null;
    try {
      const complianceMap = await getComplianceStatusBySupplierIds([rows[0].supplier_id]);
      supplierCompliance = complianceMap.get(rows[0].supplier_id) || null;
    } catch (complianceErr) {
      console.warn(
        '⚠️ Unable to resolve supplier compliance for contract creation response:',
        complianceErr?.message || complianceErr
      );
    }
    const contract = serializeContract(rows[0], supplierCompliance);
    await ensureContractsPhaseFourTables();
    await ensurePendingRenewalEvent(client, { contractId: contract.id, renewalDate: contract.end_date, noticeDays: contract.renewal_notice_days || 90, renewalType: contract.renewal_type || null, actorId: req.user?.id || null });

    await client.query('SAVEPOINT contract_evaluation_bootstrap');
    try {
      await ensureEvaluationCriteriaTable();
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
      await client.query('RELEASE SAVEPOINT contract_evaluation_bootstrap');
    } catch (evaluationBootstrapErr) {
      await client.query('ROLLBACK TO SAVEPOINT contract_evaluation_bootstrap');
      await client.query('RELEASE SAVEPOINT contract_evaluation_bootstrap');
      console.warn(
        '⚠️ Contract created without auto-generated evaluation assignments:',
        evaluationBootstrapErr?.message || evaluationBootstrapErr
      );
    }
    try {
      await recordContractLog(client, {
        contractId: contract.id,
        action: 'contract_created',
        actorId: req.user?.id || null,
        details: { status: contract.status },
      });
    } catch (contractLogErr) {
      console.warn(
        '⚠️ Failed to write contract_created log entry:',
        contractLogErr?.message || contractLogErr
      );
    }

    await client.query('COMMIT');
    res.status(201).json(contract);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return next(createHttpError(409, 'A contract with this reference number already exists'));
    }
    if (err?.code === '23503') {
      const constraint = String(err?.constraint || '');
      if (constraint.includes('source_request_id')) {
        return next(createHttpError(404, `Request #${sourceRequestId} was not found`));
      }
      if (constraint.includes('supplier_id')) {
        return next(createHttpError(404, 'The selected supplier was not found'));
      }
      if (constraint.includes('end_user_department_id')) {
        return next(createHttpError(404, 'The selected end-user department was not found'));
      }
      if (constraint.includes('contract_manager_id')) {
        return next(createHttpError(404, 'The selected contract manager was not found'));
      }
      return next(createHttpError(400, 'One or more related records for this contract are missing'));
    }
    if (err?.code === '22P02') {
      return next(createHttpError(400, 'Contract payload contains invalid value types'));
    }
    if (err?.code === '23502') {
      return next(createHttpError(400, 'A required contract field is missing'));
    }
    if (err?.code === '22001') {
      return next(createHttpError(400, 'One or more contract fields exceed allowed length'));
    }
    if (err?.code === '22007' || err?.code === '22008') {
      return next(createHttpError(400, 'Contract payload contains an invalid date value'));
    }
    if (err?.code === '42P01') {
      return next(
        createHttpError(
          503,
          'Contract setup is incomplete. Please run backend database setup and try again.'
        )
      );
    }
    if (typeof err?.code === 'string' && (err.code.startsWith('22') || err.code.startsWith('23'))) {
      return next(createHttpError(400, 'Contract payload failed database validation checks'));
    }
    if (err?.statusCode) {
      return next(err);
    }
    console.error('❌ Failed to create contract:', {
      message: err?.message,
      code: err?.code,
      constraint: err?.constraint,
      detail: err?.detail,
    });
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
    await ensureContractsPhaseTwoTables();
    const current = await client.query(
      `SELECT id, start_date, signing_date, end_date, status, renewal_notice_days, vendor, supplier_id, source_request_id, contract_value, amount_paid, clm_additional_payload
         FROM contracts
        WHERE id = $1
        LIMIT 1`,
      [contractId]
    );

    if (current.rowCount === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    existing = current.rows[0];

    const existingContractValue =
      existing.contract_value === null || existing.contract_value === undefined
        ? null
        : Number(existing.contract_value);
    const existingAmountPaid =
      existing.amount_paid === null || existing.amount_paid === undefined ? null : Number(existing.amount_paid);

    let nextContractValue = existingContractValue;
    let nextAmountPaid = existingAmountPaid;

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
    const commercialTerms =
      req.body?.commercial_terms !== undefined ? normalizeText(req.body.commercial_terms) || null : undefined;
    const complianceLegalTerms =
      req.body?.compliance_legal_terms !== undefined ? normalizeText(req.body.compliance_legal_terms) || null : undefined;
    const financialPaymentControl =
      req.body?.financial_payment_control !== undefined ? normalizeText(req.body.financial_payment_control) || null : undefined;
    const riskDisputeManagement =
      req.body?.risk_dispute_management !== undefined ? normalizeText(req.body.risk_dispute_management) || null : undefined;
    const digitalAttachmentsTracking =
      req.body?.digital_attachments_tracking !== undefined ? normalizeText(req.body.digital_attachments_tracking) || null : undefined;
    const institute =
      req.body?.institute !== undefined ? normalizeText(req.body.institute) || null : undefined;
    const contractCategory =
      req.body?.contract_category !== undefined ? normalizeText(req.body.contract_category) || null : undefined;
    const renewalType =
      req.body?.renewal_type !== undefined ? normalizeText(req.body.renewal_type) || null : undefined;
    const contractOwner =
      req.body?.contract_owner !== undefined ? normalizeText(req.body.contract_owner) || null : undefined;
    const currency =
      req.body?.currency !== undefined ? normalizeText(req.body.currency) || null : undefined;
    const firstParty =
      req.body?.first_party !== undefined ? normalizeText(req.body.first_party) || null : undefined;
    const secondParty =
      req.body?.second_party !== undefined ? normalizeText(req.body.second_party) || null : undefined;
    const authorizedSignatory =
      req.body?.authorized_signatory !== undefined ? normalizeText(req.body.authorized_signatory) || null : undefined;
    const vendorContactPerson =
      req.body?.vendor_contact_person !== undefined ? normalizeText(req.body.vendor_contact_person) || null : undefined;
    const vendorContactEmail =
      req.body?.vendor_contact_email !== undefined ? normalizeText(req.body.vendor_contact_email) || null : undefined;
    const vendorContactPhone =
      req.body?.vendor_contact_phone !== undefined ? normalizeText(req.body.vendor_contact_phone) || null : undefined;
    const vendorTaxId =
      req.body?.vendor_tax_id !== undefined ? normalizeText(req.body.vendor_tax_id) || null : undefined;
    const vendorAddress =
      req.body?.vendor_address !== undefined ? normalizeText(req.body.vendor_address) || null : undefined;
    const scopeSummary =
      req.body?.scope_summary !== undefined ? normalizeText(req.body.scope_summary) || null : undefined;
    const deliverables =
      req.body?.deliverables !== undefined ? normalizeText(req.body.deliverables) || null : undefined;
    const technicalSpecifications =
      req.body?.technical_specifications !== undefined ? normalizeText(req.body.technical_specifications) || null : undefined;
    const serviceCoverage =
      req.body?.service_coverage !== undefined ? normalizeText(req.body.service_coverage) || null : undefined;
    const exclusions =
      req.body?.exclusions !== undefined ? normalizeText(req.body.exclusions) || null : undefined;
    const slaRequirements =
      req.body?.sla_requirements !== undefined ? normalizeText(req.body.sla_requirements) || null : undefined;
    const paymentTermsDetails =
      req.body?.payment_terms_details !== undefined ? normalizeText(req.body.payment_terms_details) || null : undefined;
    const deliveryLogisticsDetails =
      req.body?.delivery_logistics_details !== undefined ? normalizeText(req.body.delivery_logistics_details) || null : undefined;
    const slaDetails =
      req.body?.sla_details !== undefined ? normalizeText(req.body.sla_details) || null : undefined;
    const penaltiesIncentives =
      req.body?.penalties_incentives !== undefined ? normalizeText(req.body.penalties_incentives) || null : undefined;
    const changeManagementTerms =
      req.body?.change_management_terms !== undefined ? normalizeText(req.body.change_management_terms) || null : undefined;
    const terminationExitTerms =
      req.body?.termination_exit_terms !== undefined ? normalizeText(req.body.termination_exit_terms) || null : undefined;
    const alertRules =
      req.body?.alert_rules !== undefined ? normalizeText(req.body.alert_rules) || null : undefined;
    const clmAdditionalPayload = extractAdditionalClmPayload(req.body || {});


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
    if (commercialTerms !== undefined) {
      pushAssignment('commercial_terms', commercialTerms);
    }
    if (complianceLegalTerms !== undefined) {
      pushAssignment('compliance_legal_terms', complianceLegalTerms);
    }
    if (financialPaymentControl !== undefined) {
      pushAssignment('financial_payment_control', financialPaymentControl);
    }
    if (riskDisputeManagement !== undefined) {
      pushAssignment('risk_dispute_management', riskDisputeManagement);
    }
    if (digitalAttachmentsTracking !== undefined) {
      pushAssignment('digital_attachments_tracking', digitalAttachmentsTracking);
    }


    if (institute !== undefined) pushAssignment('institute', institute);
    if (contractCategory !== undefined) pushAssignment('contract_category', contractCategory);
    if (renewalType !== undefined) pushAssignment('renewal_type', renewalType);
    if (req.body?.renewal_notice_days !== undefined) {
      pushAssignment('renewal_notice_days', parseOptionalInteger(req.body.renewal_notice_days, 'renewal_notice_days'));
    }
    if (contractOwner !== undefined) pushAssignment('contract_owner', contractOwner);
    if (currency !== undefined) pushAssignment('currency', currency);
    if (req.body?.estimated_contract_value !== undefined) {
      pushAssignment('estimated_contract_value', parseContractValue(req.body.estimated_contract_value));
    }
    if (req.body?.actual_consumed_value !== undefined) {
      pushAssignment('actual_consumed_value', parseContractValue(req.body.actual_consumed_value));
    }
    if (firstParty !== undefined) pushAssignment('first_party', firstParty);
    if (secondParty !== undefined) pushAssignment('second_party', secondParty);
    if (authorizedSignatory !== undefined) pushAssignment('authorized_signatory', authorizedSignatory);
    if (vendorContactPerson !== undefined) pushAssignment('vendor_contact_person', vendorContactPerson);
    if (vendorContactEmail !== undefined) pushAssignment('vendor_contact_email', vendorContactEmail);
    if (vendorContactPhone !== undefined) pushAssignment('vendor_contact_phone', vendorContactPhone);
    if (vendorTaxId !== undefined) pushAssignment('vendor_tax_id', vendorTaxId);
    if (vendorAddress !== undefined) pushAssignment('vendor_address', vendorAddress);
    if (scopeSummary !== undefined) pushAssignment('scope_summary', scopeSummary);
    if (deliverables !== undefined) pushAssignment('deliverables', deliverables);
    if (technicalSpecifications !== undefined) pushAssignment('technical_specifications', technicalSpecifications);
    if (serviceCoverage !== undefined) pushAssignment('service_coverage', serviceCoverage);
    if (exclusions !== undefined) pushAssignment('exclusions', exclusions);
    if (slaRequirements !== undefined) pushAssignment('sla_requirements', slaRequirements);
    if (paymentTermsDetails !== undefined) pushAssignment('payment_terms_details', paymentTermsDetails);
    if (deliveryLogisticsDetails !== undefined) pushAssignment('delivery_logistics_details', deliveryLogisticsDetails);
    if (slaDetails !== undefined) pushAssignment('sla_details', slaDetails);
    if (penaltiesIncentives !== undefined) pushAssignment('penalties_incentives', penaltiesIncentives);
    if (changeManagementTerms !== undefined) pushAssignment('change_management_terms', changeManagementTerms);
    if (terminationExitTerms !== undefined) pushAssignment('termination_exit_terms', terminationExitTerms);
    if (alertRules !== undefined) pushAssignment('alert_rules', alertRules);
    if (Object.keys(clmAdditionalPayload).length > 0) {
      const mergedPayload = { ...(parseJson(existing.clm_additional_payload) || {}), ...clmAdditionalPayload };
      pushAssignment('clm_additional_payload', toJsonbParameter(mergedPayload));
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
      const requestedStatus = normalizeStatus(req.body.status);
      if (!requestedStatus) {
        return next(createHttpError(400, 'status is invalid'));
      }
      const status = ensureValidStatusTransition({ currentStatus: existing.status, nextStatus: requestedStatus });
      pushAssignment('status', status);
      await recordContractLog(client, { contractId, action: 'contract_status_changed', actorId: req.user?.id || null, details: { from: normalizeStatus(existing.status), to: status } });
    }

    let requestedStart;
    let startProvided = false;
    if (req.body?.start_date !== undefined) {
      requestedStart = parseISODate(req.body.start_date, 'start_date');
      startProvided = true;
      pushAssignment('start_date', requestedStart);
    }

    let requestedSigning;
    let signingProvided = false;
    if (req.body?.signing_date !== undefined) {
      requestedSigning = parseISODate(req.body.signing_date, 'signing_date');
      signingProvided = true;
      pushAssignment('signing_date', requestedSigning);
    }

    let requestedEnd;
    let endProvided = false;
    if (req.body?.end_date !== undefined) {
      requestedEnd = parseISODate(req.body.end_date, 'end_date');
      endProvided = true;
      pushAssignment('end_date', requestedEnd);
    }

    if (req.body?.contract_value !== undefined) {
      const parsedContractValue = parseContractValue(req.body.contract_value);
      nextContractValue = parsedContractValue;
      pushAssignment('contract_value', parsedContractValue);
    }

    if (req.body?.amount_paid !== undefined) {
      const parsedAmountPaid = parseAmountPaid(req.body.amount_paid);
      nextAmountPaid = parsedAmountPaid;
      pushAssignment('amount_paid', parsedAmountPaid);
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

    const currentVendor = normalizeText(existing.vendor);
    const nextVendor = vendor !== undefined ? vendor : currentVendor;
    const vendorChanged = vendor !== undefined && nextVendor !== currentVendor;

    const needsSupplierResolution = supplierProvided || vendorChanged;
    if (needsSupplierResolution) {
      const supplier = await resolveSupplier(client, {
        supplierId: supplierProvided ? supplierId : null,
        vendorName: nextVendor,
      });
      const vendorNameToPersist = vendor !== undefined ? vendor : supplier.name;
      pushAssignment('vendor', vendorNameToPersist);
      pushAssignment('supplier_id', supplier.id);
    } else if (vendor !== undefined) {
      pushAssignment('vendor', vendor);
    }

    if (assignments.length === 0) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'No valid fields provided for update'));
    }

    assignments.push('updated_at = NOW()');

    const currentStart = toISODateString(existing.start_date);
    const currentSigning = toISODateString(existing.signing_date);
    const currentEnd = toISODateString(existing.end_date);
    const nextStart = startProvided ? requestedStart : currentStart;
    const nextSigning = signingProvided ? requestedSigning : currentSigning;
    const nextEnd = endProvided ? requestedEnd : currentEnd;

    if (nextStart && nextEnd && nextStart > nextEnd) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'end_date must be after start_date'));
    }

    if (nextSigning && nextStart && nextSigning > nextStart) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'signing_date must be on or before start_date'));
    }

    if (nextSigning && nextEnd && nextSigning > nextEnd) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'signing_date must be on or before end_date'));
    }

    let computedStatus = normalizeStatus(existing.status) || 'draft';
    const statusAssignmentIndex = assignments.findIndex(entry => entry.startsWith('status = '));
    if (statusAssignmentIndex >= 0) {
      computedStatus = values[statusAssignmentIndex];
    }
    const autoStatus = computeExpiringSoonStatus({ status: computedStatus, startDate: nextStart, endDate: nextEnd, renewalNoticeDays: req.body?.renewal_notice_days !== undefined ? req.body.renewal_notice_days : existing.renewal_notice_days });
    if (autoStatus !== computedStatus) {
      if (statusAssignmentIndex >= 0) {
        values[statusAssignmentIndex] = autoStatus;
      } else {
        pushAssignment('status', autoStatus);
      }
      await recordContractLog(client, { contractId, action: 'contract_status_auto_adjusted', actorId: req.user?.id || null, details: { from: computedStatus, to: autoStatus, reason: 'expiry_window' } });
    }

if (
      typeof nextContractValue === 'number' &&
      nextContractValue !== null &&
      typeof nextAmountPaid === 'number' &&
      nextAmountPaid !== null &&
      nextAmountPaid > nextContractValue
    ) {
      await client.query('ROLLBACK');
      return next(createHttpError(400, 'amount_paid cannot exceed contract_value'));
    }

    const { rows } = await client.query(
      `UPDATE contracts
          SET ${assignments.join(', ')}
        WHERE id = $${values.length + 1}
        RETURNING id, title, vendor, supplier_id, source_request_id, reference_number, start_date, signing_date, end_date, contract_value, amount_paid, status, description,
                  delivery_terms, warranty_terms, performance_management,
                  commercial_terms, compliance_legal_terms, financial_payment_control, risk_dispute_management, digital_attachments_tracking,
              institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
              estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
              vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
              scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
              payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
              change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
                  end_user_department_id, contract_manager_id, technical_department_ids,
                  created_by, created_at, updated_at`,
      [...values, contractId]
    );
    await recordContractLog(client, {
      contractId,
      action: 'contract_updated',
      actorId: req.user?.id || null,
      details: null,
    });

    await client.query('COMMIT');
    await ensureContractsPhaseFourTables();
    await ensurePendingRenewalEvent(pool, { contractId, renewalDate: rows[0].end_date, noticeDays: rows[0].renewal_notice_days || 90, renewalType: rows[0].renewal_type || null, actorId: req.user?.id || null });
    const complianceMap = await getComplianceStatusBySupplierIds([rows[0].supplier_id]);
    res.json(serializeContract(rows[0], complianceMap.get(rows[0].supplier_id) || null));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.statusCode) {
      return next(err);
    }
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
    await ensureContractsPhaseTwoTables();
    const { rows } = await pool.query(
      `UPDATE contracts
          SET status = 'archived', updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, vendor, supplier_id, source_request_id, reference_number, start_date, signing_date, end_date, contract_value, amount_paid, status, description,
                  delivery_terms, warranty_terms, performance_management,
                  commercial_terms, compliance_legal_terms, financial_payment_control, risk_dispute_management, digital_attachments_tracking,
              institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
              estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
              vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
              scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
              payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
              change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
                  end_user_department_id, contract_manager_id, technical_department_ids,
                  created_by, created_at, updated_at`,
      [contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }
    await pool.query(
      `INSERT INTO contract_logs (contract_id, action, actor_id, details) VALUES ($1,$2,$3,$4)`,
      [contractId, 'contract_archived', req.user?.id || null, null]
    );

    const complianceMap = await getComplianceStatusBySupplierIds([rows[0].supplier_id]);
    res.json(serializeContract(rows[0], complianceMap.get(rows[0].supplier_id) || null));
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
const { getUploadedFile, describeUploadPayload } = require('../utils/uploadedFile');
const { serializeAttachment } = require('../utils/attachmentPaths');

const removeStoredAttachmentFile = async storedPath => {
  if (!storedPath) {
    return;
  }

  try {
    if (isStoredLocally(storedPath)) {
      const localPath = resolveStoredLocalPath(storedPath);
      if (localPath) {
        await fs.unlink(localPath).catch(err => {
          if (err?.code !== 'ENOENT') {
            console.warn('⚠️ Failed to delete local attachment:', err.message);
          }
        });
      }
      return;
    }

    await removeObject(storedPath).catch(err => {
      console.warn('⚠️ Failed to delete attachment from storage:', err.message);
    });
  } catch (err) {
    console.warn('⚠️ Failed to cleanup attachment file:', err.message);
  }
};

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
  const file = getUploadedFile(req);

  if (!file) {
    console.warn('⚠️ Contract upload request missing file. Payload:', JSON.stringify(describeUploadPayload(req)));
    return next(createHttpError(400, 'No file uploaded'));
  }

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
    console.error('❌ Upload error:', err.message, '| upload payload:', JSON.stringify(describeUploadPayload(req)));
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

const deleteContractAttachment = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to delete attachments'));
  }

  const contractId = Number.parseInt(req.params.contractId, 10);
  const attachmentId = Number.parseInt(req.params.attachmentId, 10);

  if (!Number.isInteger(contractId) || !Number.isInteger(attachmentId)) {
    return next(createHttpError(400, 'Invalid contract or attachment id'));
  }

  let client;

  try {
    client = await pool.connect();
    await ensureAttachmentsContractIdColumn(client);

    const supportsContractAttachments = await attachmentsHasContractIdColumn(client);
    if (!supportsContractAttachments) {
      return next(createHttpError(400, 'Contract attachments are not supported by this database schema'));
    }

    const { rows } = await client.query(
      `SELECT id, file_path
         FROM attachments
        WHERE id = $1
          AND contract_id = $2`,
      [attachmentId, contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Attachment not found for this contract'));
    }

    await client.query('DELETE FROM attachments WHERE id = $1', [attachmentId]);

    await removeStoredAttachmentFile(rows[0].file_path);

    res.json({ message: 'Attachment deleted successfully' });
  } catch (err) {
    console.error('❌ Failed to delete contract attachment:', err);
    next(createHttpError(500, 'Failed to delete attachment'));
  } finally {
    if (client) {
      client.release();
    }
  }
};

const renewContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to renew contracts'));
  }

  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  const nextStart = toISODateString(req.body?.start_date) || null;
  const nextEnd = toISODateString(req.body?.end_date) || null;

  if (!nextEnd) {
    return next(createHttpError(400, 'end_date is required to renew a contract'));
  }

  if (nextStart && nextEnd && nextStart > nextEnd) {
    return next(createHttpError(400, 'end_date must be after start_date'));
  }

  const nextStatusRaw = normalizeStatus(req.body?.status || 'renewed');
  if (!nextStatusRaw) {
    return next(createHttpError(400, 'Invalid status for renewal'));
  }

  const contractValue = req.body?.contract_value;
  const amountPaid = req.body?.amount_paid;

  const parsedValue =
    contractValue === null || contractValue === undefined || contractValue === ''
      ? null
      : Number(contractValue);
  const parsedPaid =
    amountPaid === null || amountPaid === undefined || amountPaid === '' ? null : Number(amountPaid);

  if ((parsedValue !== null && !Number.isFinite(parsedValue)) || (parsedPaid !== null && !Number.isFinite(parsedPaid))) {
    return next(createHttpError(400, 'contract_value and amount_paid must be numbers'));
  }

  if (parsedValue !== null && parsedPaid !== null && parsedPaid > parsedValue) {
    return next(createHttpError(400, 'amount_paid cannot exceed contract_value'));
  }

  try {
    await ensureContractsTable();
    await ensureContractsPhaseTwoTables();
    const { rows: currentRows } = await pool.query('SELECT id, status, renewal_notice_days, supplier_id FROM contracts WHERE id=$1', [contractId]);
    if (!currentRows.length) return next(createHttpError(404, 'Contract not found'));
    const validatedStatus = ensureValidStatusTransition({ currentStatus: currentRows[0].status, nextStatus: nextStatusRaw, allowArchivedSource: false });

    const { rows } = await pool.query(
      `UPDATE contracts
          SET start_date = COALESCE($1, start_date),
              end_date = $2,
              status = $3,
              contract_value = COALESCE($4, contract_value),
              amount_paid = COALESCE($5, amount_paid),
              updated_at = NOW()
        WHERE id = $6
        RETURNING id, title, vendor, supplier_id, source_request_id, reference_number, start_date, signing_date, end_date, contract_value, amount_paid, status, description,
                  delivery_terms, warranty_terms, performance_management,
                  commercial_terms, compliance_legal_terms, financial_payment_control, risk_dispute_management, digital_attachments_tracking,
              institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
              estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
              vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
              scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
              payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
              change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
                  end_user_department_id, contract_manager_id, technical_department_ids,
                  created_by, created_at, updated_at`,
      [nextStart, nextEnd, validatedStatus, parsedValue, parsedPaid, contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }
    await pool.query(
      `INSERT INTO contract_logs (contract_id, action, actor_id, details) VALUES ($1,$2,$3,$4)`,
      [contractId, 'contract_renewed', req.user?.id || null, JSON.stringify({ from: normalizeStatus(currentRows[0].status), to: validatedStatus })]
    );
    
    const complianceMap = await getComplianceStatusBySupplierIds([rows[0].supplier_id]);
    res.json(serializeContract(rows[0], complianceMap.get(rows[0].supplier_id) || null));
  } catch (err) {
    console.error('❌ Failed to renew contract:', err);
    next(createHttpError(500, 'Failed to renew contract'));
  }
};

const unarchiveContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to unarchive contracts'));
  }

  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  try {
    await ensureContractsTable();
    await ensureContractsPhaseTwoTables();
    const { rows } = await pool.query(
      `UPDATE contracts
          SET status = CASE
                WHEN start_date IS NULL THEN 'draft'
                WHEN end_date IS NOT NULL AND end_date < CURRENT_DATE THEN 'expired'
                WHEN start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE) THEN 'active'
                ELSE 'draft'
              END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, vendor, supplier_id, source_request_id, reference_number, start_date, signing_date, end_date, contract_value, amount_paid, status, description,
                  delivery_terms, warranty_terms, performance_management,
                  commercial_terms, compliance_legal_terms, financial_payment_control, risk_dispute_management, digital_attachments_tracking,
              institute, contract_category, renewal_type, renewal_notice_days, contract_owner, currency,
              estimated_contract_value, actual_consumed_value, first_party, second_party, authorized_signatory,
              vendor_contact_person, vendor_contact_email, vendor_contact_phone, vendor_tax_id, vendor_address,
              scope_summary, deliverables, technical_specifications, service_coverage, exclusions, sla_requirements,
              payment_terms_details, delivery_logistics_details, sla_details, penalties_incentives,
              change_management_terms, termination_exit_terms, alert_rules, clm_additional_payload,
                  end_user_department_id, contract_manager_id, technical_department_ids,
                  created_by, created_at, updated_at`,
      [contractId]
    );

    if (rows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }
    
    const complianceMap = await getComplianceStatusBySupplierIds([rows[0].supplier_id]);
    res.json(serializeContract(rows[0], complianceMap.get(rows[0].supplier_id) || null));
  } catch (err) {
    console.error('❌ Failed to unarchive contract:', err);
    next(createHttpError(500, 'Failed to unarchive contract'));
  }
};

const deleteContract = async (req, res, next) => {
  if (!canManageContracts(req)) {
    return next(createHttpError(403, 'You are not authorized to delete contracts'));
  }

  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) {
    return next(createHttpError(400, 'Invalid contract id'));
  }

  let client;

  try {
    client = await pool.connect();
    await ensureContractsTable();
    await ensureContractEvaluationsTable();
    await ensureAttachmentsContractIdColumn(client);

    const { rows: contractRows } = await client.query(
      'SELECT id, supplier_id FROM contracts WHERE id = $1',
      [contractId]
    );

    if (contractRows.length === 0) {
      return next(createHttpError(404, 'Contract not found'));
    }

    const { rows: attachmentRows } = await client.query(
      `SELECT id, file_path
         FROM attachments
        WHERE contract_id = $1`,
      [contractId]
    );

    await client.query('BEGIN');
    await recordContractLog(client, {
      contractId,
      action: 'contract_deleted',
      actorId: req.user?.id || null,
      details: null,
    });

    await client.query('DELETE FROM contract_evaluations WHERE contract_id = $1', [contractId]);
    await client.query('DELETE FROM attachments WHERE contract_id = $1', [contractId]);
    await client.query('DELETE FROM contracts WHERE id = $1', [contractId]);

    await client.query('COMMIT');

    await Promise.all((attachmentRows || []).map(row => removeStoredAttachmentFile(row.file_path)));

    res.json({ message: 'Contract deleted successfully' });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('❌ Failed to delete contract:', err);
    next(createHttpError(500, 'Failed to delete contract'));
  } finally {
    if (client) {
      client.release();
    }
  }
};

const listContractAmendments = async (req, res, next) => {
  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  try {
    await ensureContractsTable();
    await ensureContractsPhaseTwoTables();
    const { rows } = await pool.query(
      `SELECT id, contract_id, amendment_number, amendment_date, change_summary, revised_value, revised_expiry, approved_by, snapshot, created_at
         FROM contract_amendments
        WHERE contract_id = $1
        ORDER BY amendment_number DESC, created_at DESC`,
      [contractId]
    );
    res.json(rows);
  } catch (err) {
    next(createHttpError(500, 'Failed to list contract amendments'));
  }
};

const createContractAmendment = async (req, res, next) => {
  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  const client = await pool.connect();
  try {
    await ensureContractsTable();
    await ensureContractsPhaseTwoTables();
    const { rows: contractRows } = await client.query('SELECT * FROM contracts WHERE id = $1', [contractId]);
    if (!contractRows.length) return next(createHttpError(404, 'Contract not found'));
    const contract = contractRows[0];
    const { rows: numRows } = await client.query(
      'SELECT COALESCE(MAX(amendment_number),0)+1 AS next_number FROM contract_amendments WHERE contract_id = $1',
      [contractId]
    );
    const nextNumber = Number(numRows[0].next_number);
    const revisedValue = req.body?.revised_value === undefined ? null : parseContractValue(req.body.revised_value);
    const revisedExpiry = parseISODate(req.body?.revised_expiry, 'revised_expiry');
    const changeSummary = normalizeText(req.body?.change_summary) || null;
    const amendmentDate = parseISODate(req.body?.amendment_date, 'amendment_date') || new Date().toISOString().slice(0, 10);

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO contract_amendments
       (contract_id, amendment_number, amendment_date, change_summary, revised_value, revised_expiry, approved_by, snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [contractId, nextNumber, amendmentDate, changeSummary, revisedValue, revisedExpiry, req.user?.id || null, JSON.stringify(contract)]
    );
    if (revisedValue !== null || revisedExpiry) {
      const updates = ['updated_at = NOW()'];
      const vals = [];
      if (revisedValue !== null) {
        vals.push(revisedValue);
        updates.push(`contract_value = $${vals.length}`);
      }
      if (revisedExpiry) {
        vals.push(revisedExpiry);
        updates.push(`end_date = $${vals.length}`);
      }
      vals.push(contractId);
      await client.query(`UPDATE contracts SET ${updates.join(', ')} WHERE id = $${vals.length}`, vals);
    }
    await recordContractLog(client, { contractId, action: 'contract_amended', actorId: req.user?.id || null, details: { amendment_number: nextNumber } });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(createHttpError(500, 'Failed to create contract amendment'));
  } finally {
    client.release();
  }
};

const APPROVAL_CHAIN = [
  { level: 1, stage: 'Legal Review', reviewer_role: 'legal', status: 'legal_review' },
  { level: 2, stage: 'Finance Review', reviewer_role: 'finance', status: 'finance_review' },
  { level: 3, stage: 'Technical Review', reviewer_role: 'technical', status: 'technical_review' },
  { level: 4, stage: 'SCM Review', reviewer_role: 'scm', status: 'under_review' },
  { level: 5, stage: 'COO/CEO Approval', reviewer_role: 'coo_ceo', status: 'under_review' },
];

const submitContractReview = async (req, res, next) => {
  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  const client = await pool.connect();
  try {
    await ensureContractsPhaseTwoTables();
    await client.query('BEGIN');
    const { rows: contracts } = await client.query('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [contractId]);
    if (!contracts.length) return next(createHttpError(404, 'Contract not found'));
    await client.query('DELETE FROM contract_approvals WHERE contract_id = $1', [contractId]);
    for (const step of APPROVAL_CHAIN) {
      await client.query(`INSERT INTO contract_approvals (contract_id, approval_level, stage, reviewer_role, reviewer_id, status, is_active, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [contractId, step.level, step.stage, step.reviewer_role, null, 'Pending', step.level === 1]);
    }
    await client.query(`UPDATE contracts SET status='under_review', updated_at=NOW() WHERE id=$1`, [contractId]);
    await recordContractLog(client, { contractId, action: 'contract_review_submitted', actorId: req.user?.id || null });
    await client.query('COMMIT');
    res.json({ message: 'Contract submitted for review' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(createHttpError(500, 'Failed to submit review workflow'));
  } finally { client.release(); }
};

const listContractApprovals = async (req, res, next) => {
  const contractId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  try {
    await ensureContractsPhaseTwoTables();
    const { rows } = await pool.query(`SELECT id, contract_id, approval_level, stage, reviewer_role, reviewer_id, status, comments, is_active, decided_at, created_at
      FROM contract_approvals WHERE contract_id=$1 ORDER BY approval_level`, [contractId]);
    res.json(rows);
  } catch {
    next(createHttpError(500, 'Failed to fetch approvals'));
  }
};

const decideContractApproval = async (req, res, next) => {
  const contractId = Number(req.params.id); const approvalId = Number(req.params.approvalId);
  const decision = normalizeText(req.body?.decision);
  if (!Number.isInteger(contractId) || !Number.isInteger(approvalId)) return next(createHttpError(400, 'Invalid id'));
  if (!['Approved', 'Rejected', 'Returned'].includes(decision)) return next(createHttpError(400, 'Invalid decision'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM contract_approvals WHERE id=$1 AND contract_id=$2 FOR UPDATE`, [approvalId, contractId]);
    if (!rows.length) return next(createHttpError(404, 'Approval step not found'));
    const current = rows[0];
    if (!current.is_active) return next(createHttpError(400, 'Only active approval can be decided'));
    await client.query(`UPDATE contract_approvals SET status=$1, comments=$2, decided_at=NOW(), is_active=FALSE, updated_at=NOW() WHERE id=$3`, [decision, normalizeText(req.body?.comments) || null, approvalId]);
    if (decision === 'Approved') {
      const { rows: nextStep } = await client.query(`SELECT id, approval_level FROM contract_approvals WHERE contract_id=$1 AND approval_level > $2 ORDER BY approval_level LIMIT 1`, [contractId, current.approval_level]);
      if (nextStep.length) {
        await client.query(`UPDATE contract_approvals SET is_active=TRUE WHERE id=$1`, [nextStep[0].id]);
      } else {
        await client.query(`UPDATE contracts SET status='sent_for_signature', updated_at=NOW() WHERE id=$1`, [contractId]);
      }
    } else {
      await client.query(`UPDATE contracts SET status='draft', updated_at=NOW() WHERE id=$1`, [contractId]);
    }
    await recordContractLog(client, { contractId, action: 'contract_approval_decision', actorId: req.user?.id || null, details: { approvalId, decision } });
    await client.query('COMMIT');
    res.json({ message: 'Decision recorded' });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    next(createHttpError(500, 'Failed to save approval decision'));
  } finally { client.release(); }
};

const assertContractExists = async (client, contractId) => {
  const { rows } = await client.query('SELECT id, contract_value, estimated_contract_value, actual_consumed_value, amount_paid, status, end_date, renewal_notice_days, supplier_id FROM contracts WHERE id=$1', [contractId]);
  if (!rows.length) throw createHttpError(404, 'Contract not found');
  return rows[0];
};

const listContractItems = async (req, res, next) => {
  const contractId = Number(req.params.id);
  if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  try {
    await ensureContractsPhaseTwoTables();
    await assertContractExists(pool, contractId);
    const { rows } = await pool.query('SELECT * FROM contract_items WHERE contract_id=$1 ORDER BY id DESC', [contractId]);
    res.json(rows);
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to fetch contract items')); }
};

const upsertContractItemValidation = (payload = {}) => {
  if (!normalizeText(payload.item_name)) throw createHttpError(400, 'item_name is required');
  if (payload.contracted_price !== undefined && payload.contracted_price !== null && payload.contracted_price !== '' && Number.isNaN(Number(payload.contracted_price))) throw createHttpError(400, 'contracted_price must be numeric');
  if (payload.lead_time_days !== undefined && payload.lead_time_days !== null && payload.lead_time_days !== '') {
    const ltd = Number(payload.lead_time_days);
    if (!Number.isInteger(ltd) || ltd <= 0) throw createHttpError(400, 'lead_time_days must be a positive integer');
  }
  const from = payload.price_valid_from ? new Date(payload.price_valid_from) : null;
  const to = payload.price_valid_to ? new Date(payload.price_valid_to) : null;
  if (from && to && from > to) throw createHttpError(400, 'price_valid_from must be before or equal to price_valid_to');
};

const createContractItem = async (req, res, next) => {
  const contractId = Number(req.params.id);
  if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  const client = await pool.connect();
  try {
    await ensureContractsPhaseTwoTables(); upsertContractItemValidation(req.body || {}); await client.query('BEGIN'); await assertContractExists(client, contractId);
    const b = req.body || {};
    const { rows } = await client.query(`INSERT INTO contract_items (contract_id,item_id,item_name,generic_name,brand_name,unit,contracted_price,currency,minimum_order_quantity,lead_time_days,warranty_terms,price_valid_from,price_valid_to,is_active,notes,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING *`,
      [contractId, b.item_id || null, normalizeText(b.item_name), normalizeText(b.generic_name) || null, normalizeText(b.brand_name) || null, normalizeText(b.unit) || null, b.contracted_price === '' ? null : b.contracted_price ?? null, normalizeText(b.currency) || null, b.minimum_order_quantity === '' ? null : b.minimum_order_quantity ?? null, b.lead_time_days === '' ? null : b.lead_time_days ?? null, normalizeText(b.warranty_terms) || null, b.price_valid_from || null, b.price_valid_to || null, b.is_active !== false, normalizeText(b.notes) || null]);
    await recordContractLog(client, { contractId, action: 'contract_item_created', actorId: req.user?.id || null, details: { item_id: rows[0].id } });
    await client.query('COMMIT'); res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err.statusCode ? err : createHttpError(500, 'Failed to create contract item')); } finally { client.release(); }
};

const updateContractItem = async (req, res, next) => {
  const contractId = Number(req.params.id); const itemId = Number(req.params.itemId);
  if (!Number.isInteger(contractId) || !Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid id'));
  const client = await pool.connect();
  try {
    await ensureContractsPhaseTwoTables(); upsertContractItemValidation(req.body || {}); await client.query('BEGIN'); await assertContractExists(client, contractId);
    const b = req.body || {};
    const { rows } = await client.query(`UPDATE contract_items SET item_name=$1,generic_name=$2,brand_name=$3,unit=$4,contracted_price=$5,currency=$6,minimum_order_quantity=$7,lead_time_days=$8,warranty_terms=$9,price_valid_from=$10,price_valid_to=$11,is_active=$12,notes=$13,updated_at=NOW() WHERE id=$14 AND contract_id=$15 RETURNING *`,
      [normalizeText(b.item_name), normalizeText(b.generic_name) || null, normalizeText(b.brand_name) || null, normalizeText(b.unit) || null, b.contracted_price === '' ? null : b.contracted_price ?? null, normalizeText(b.currency) || null, b.minimum_order_quantity === '' ? null : b.minimum_order_quantity ?? null, b.lead_time_days === '' ? null : b.lead_time_days ?? null, normalizeText(b.warranty_terms) || null, b.price_valid_from || null, b.price_valid_to || null, b.is_active !== false, normalizeText(b.notes) || null, itemId, contractId]);
    if (!rows.length) return next(createHttpError(404, 'Contract item not found'));
    await recordContractLog(client, { contractId, action: 'contract_item_updated', actorId: req.user?.id || null, details: { item_id: itemId } });
    await client.query('COMMIT'); res.json(rows[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err.statusCode ? err : createHttpError(500, 'Failed to update contract item')); } finally { client.release(); }
};

const deleteContractItem = async (req, res, next) => {
  const contractId = Number(req.params.id); const itemId = Number(req.params.itemId);
  if (!Number.isInteger(contractId) || !Number.isInteger(itemId)) return next(createHttpError(400, 'Invalid id'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await assertContractExists(client, contractId);
    const { rowCount } = await client.query('DELETE FROM contract_items WHERE id=$1 AND contract_id=$2', [itemId, contractId]);
    if (!rowCount) return next(createHttpError(404, 'Contract item not found'));
    await recordContractLog(client, { contractId, action: 'contract_item_deleted', actorId: req.user?.id || null, details: { item_id: itemId } });
    await client.query('COMMIT'); res.json({ message: 'Contract item deleted' });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err.statusCode ? err : createHttpError(500, 'Failed to delete contract item')); } finally { client.release(); }
};

const getContractConsumption = async (req, res, next) => {
  const contractId = Number(req.params.id); if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  try {
    const c = await assertContractExists(pool, contractId);
    const safe = async q => { try { return await pool.query(q.text, q.values || []); } catch { return { rows: [] }; } };
    const po = await safe({ text: 'SELECT id, po_number, total_amount FROM purchase_orders WHERE contract_id=$1', values: [contractId] });
    const inv = await safe({ text: 'SELECT id, invoice_number, total_amount FROM supplier_invoices WHERE contract_id=$1', values: [contractId] });
    const pay = await safe({ text: 'SELECT id, voucher_number, total_amount FROM ap_vouchers WHERE contract_id=$1', values: [contractId] });
    const consumedPO = po.rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const consumedInv = inv.rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const paid = pay.rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0) || Number(c.amount_paid) || 0;
    const total = Number(c.contract_value) || Number(c.estimated_contract_value) || 0;
    const consumed = Number(c.actual_consumed_value) || Math.max(consumedPO, consumedInv);
    res.json({ contract_value: Number(c.contract_value) || 0, estimated_contract_value: Number(c.estimated_contract_value) || 0, actual_consumed_value: consumed, consumed_from_purchase_orders: consumedPO, consumed_from_invoices: consumedInv, paid_amount: paid, remaining_balance: total - consumed, consumed_percentage: total > 0 ? Number(((consumed / total) * 100).toFixed(2)) : 0, linked_purchase_orders: po.rows, linked_invoices: inv.rows, linked_payments: pay.rows });
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to fetch consumption')); }
};

const REQUIRED_DOCUMENT_TYPES = ['Draft Contract', 'Final Signed Contract', 'Supplier Offer', 'Legal Review', 'Finance Approval', 'Technical Approval', 'Tax / Registration Documents', 'Amendment Document', 'Renewal Letter', 'Termination Letter'];
const getDocumentChecklist = async (req, res, next) => {
  const contractId = Number(req.params.id); if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  try {
    await ensureContractsPhaseTwoTables(); await assertContractExists(pool, contractId);
    for (const t of REQUIRED_DOCUMENT_TYPES) await pool.query('INSERT INTO contract_required_documents (contract_id, document_type) VALUES ($1,$2) ON CONFLICT (contract_id, document_type) DO NOTHING', [contractId, t]);
    const { rows } = await pool.query('SELECT * FROM contract_required_documents WHERE contract_id=$1 ORDER BY id', [contractId]);
    res.json(rows);
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to fetch checklist')); }
};
const updateDocumentChecklist = async (req, res, next) => {
  const contractId = Number(req.params.id); const documentId = Number(req.params.documentId);
  if (!Number.isInteger(contractId) || !Number.isInteger(documentId)) return next(createHttpError(400, 'Invalid id'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await assertContractExists(client, contractId);
    const { rows } = await client.query('UPDATE contract_required_documents SET is_uploaded=$1, notes=$2, updated_at=NOW() WHERE id=$3 AND contract_id=$4 RETURNING *', [Boolean(req.body?.is_uploaded), normalizeText(req.body?.notes) || null, documentId, contractId]);
    if (!rows.length) return next(createHttpError(404, 'Checklist document not found'));
    await recordContractLog(client, { contractId, action: 'contract_document_checklist_updated', actorId: req.user?.id || null, details: { document_id: documentId, is_uploaded: rows[0].is_uploaded } });
    await client.query('COMMIT'); res.json(rows[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err.statusCode ? err : createHttpError(500, 'Failed to update checklist')); } finally { client.release(); }
};

const getContractRisk = async (req, res, next) => {
  const contractId = Number(req.params.id); if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  try { await ensureContractsPhaseSixTables();
    const {rows:cRows}=await pool.query('SELECT * FROM contracts WHERE id=$1',[contractId]); if(!cRows.length) return next(createHttpError(404,'Contract not found'));
    const contract=cRows[0];
    const [docs,renewals,invoices,obligations,cons]=await Promise.all([
      pool.query('SELECT * FROM contract_documents WHERE contract_id=$1',[contractId]),
      pool.query('SELECT * FROM contract_renewal_events WHERE contract_id=$1',[contractId]),
      pool.query('SELECT * FROM contract_invoices WHERE contract_id=$1',[contractId]),
      pool.query('SELECT * FROM contract_obligations WHERE contract_id=$1',[contractId]),
      pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM contract_consumption WHERE contract_id=$1',[contractId]),
    ]);
    const computedObligations=obligations.rows.map(withComputedOverdueStatus);
    const risk=calculateContractRisk(contract,{documents:docs.rows,renewals:renewals.rows,invoices:invoices.rows,obligations:computedObligations,totalConsumed:cons.rows[0].total});
    const persist = String(req.query?.persist || 'true') !== 'false';
    let out={...risk,assessed_at:new Date().toISOString()};
    if(persist){ const {rows}=await pool.query(`INSERT INTO contract_risk_assessments (contract_id,risk_score,risk_level,risk_factors,assessed_by,assessment_source) VALUES ($1,$2,$3,$4::jsonb,$5,'system') RETURNING *`,[contractId,risk.risk_score,risk.risk_level,JSON.stringify(risk.risk_factors),req.user?.id||null]); out=rows[0]; await recordContractLog(pool,{contractId,action:'contract_risk_assessed',actorId:req.user?.id||null,details:{score:risk.risk_score,level:risk.risk_level,factor_count:risk.risk_factors.length}}); }
    res.json(out);
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to compute risk')); }
};

const parseDocumentType = value => {
  const normalized = normalizeText(value).toLowerCase();
  if (!CONTRACT_DOCUMENT_TYPES.includes(normalized)) throw createHttpError(400, 'Invalid document_type');
  return normalized;
};
const parseDocumentStatus = value => {
  const normalized = normalizeText(value || 'active').toLowerCase();
  if (!CONTRACT_DOCUMENT_STATUSES.includes(normalized)) throw createHttpError(400, 'Invalid document status');
  return normalized;
};
const serializeDocumentSummary = row => ({ id: Number(row.id), document_type: row.document_type, title: row.title || null, status: row.status, current_version: row.current_version_id ? { id: Number(row.current_version_id), version_number: row.current_version_number ? Number(row.current_version_number) : null, file_name: row.current_file_name || null, file_url: row.current_file_url || null, uploaded_at: row.current_uploaded_at || null } : null, version_count: Number(row.version_count || 0), created_by: row.created_by ? Number(row.created_by) : null, created_at: row.created_at, updated_at: row.updated_at });
const listContractDocuments = async (req, res, next) => {
  const contractId = Number(req.params.id); if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  try { await ensureContractsPhaseThreeTables(); await assertContractExists(pool, contractId);
    const { rows } = await pool.query(`SELECT d.*, cv.version_number AS current_version_number, cv.file_name AS current_file_name, cv.file_url AS current_file_url, cv.uploaded_at AS current_uploaded_at, COUNT(v.id)::INT AS version_count
      FROM contract_documents d
      LEFT JOIN contract_document_versions v ON v.document_id=d.id
      LEFT JOIN contract_document_versions cv ON cv.id=d.current_version_id
      WHERE d.contract_id=$1 GROUP BY d.id, cv.id ORDER BY d.updated_at DESC`, [contractId]);
    res.json(rows.map(serializeDocumentSummary));
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to list contract documents')); }
};
const createContractDocument = async (req, res, next) => {
  if (!canManageContracts(req)) return next(createHttpError(403, 'You are not authorized to manage contract documents'));
  const contractId = Number(req.params.id); if (!Number.isInteger(contractId)) return next(createHttpError(400, 'Invalid contract id'));
  const client = await pool.connect();
  try {
    await ensureContractsPhaseThreeTables(); await client.query('BEGIN'); await assertContractExists(client, contractId);
    const b = req.body || {};
    const { rows } = await client.query(`INSERT INTO contract_documents (contract_id,document_type,title,description,status,created_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [contractId, parseDocumentType(b.document_type), normalizeText(b.title) || null, normalizeText(b.description) || null, parseDocumentStatus(b.status), req.user?.id || null]);
    const doc = rows[0];
    if (normalizeText(b.file_name) || normalizeText(b.file_url) || normalizeText(b.storage_path)) {
      const v = await client.query(`INSERT INTO contract_document_versions (document_id,contract_id,version_number,file_name,file_url,storage_path,mime_type,file_size,checksum,uploaded_by,is_current,notes)
        VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,TRUE,$10) RETURNING *`, [doc.id, contractId, normalizeText(b.file_name) || null, normalizeText(b.file_url) || null, normalizeText(b.storage_path) || null, normalizeText(b.mime_type) || null, b.file_size || null, normalizeText(b.checksum) || null, req.user?.id || null, normalizeText(b.notes) || null]);
      await client.query('UPDATE contract_documents SET current_version_id=$1, updated_at=NOW() WHERE id=$2', [v.rows[0].id, doc.id]);
    }
    await recordContractLog(client, { contractId, action: 'contract_document_created', actorId: req.user?.id || null, details: { document_id: doc.id } });
    await client.query('COMMIT'); res.status(201).json(doc);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err.statusCode ? err : createHttpError(500, 'Failed to create contract document')); } finally { client.release(); }
};
const getContractDocument = async (req, res, next) => {
  const contractId = Number(req.params.id); const documentId = Number(req.params.documentId);
  if (!Number.isInteger(contractId) || !Number.isInteger(documentId)) return next(createHttpError(400, 'Invalid id'));
  try { await ensureContractsPhaseThreeTables();
    const { rows: d } = await pool.query('SELECT * FROM contract_documents WHERE id=$1 AND contract_id=$2', [documentId, contractId]);
    if (!d.length) return next(createHttpError(404, 'Document not found'));
    const { rows: versions } = await pool.query('SELECT * FROM contract_document_versions WHERE document_id=$1 AND contract_id=$2 ORDER BY version_number DESC', [documentId, contractId]);
    res.json({ ...d[0], versions });
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to fetch document')); }
};
const updateContractDocument = async (req, res, next) => { if (!canManageContracts(req)) return next(createHttpError(403, 'You are not authorized to manage contract documents'));
  const contractId = Number(req.params.id); const documentId = Number(req.params.documentId); if (!Number.isInteger(contractId) || !Number.isInteger(documentId)) return next(createHttpError(400, 'Invalid id'));
  try { await ensureContractsPhaseThreeTables(); const b = req.body || {};
    const { rows } = await pool.query(`UPDATE contract_documents SET document_type=COALESCE($1,document_type),title=COALESCE($2,title),description=COALESCE($3,description),status=COALESCE($4,status),updated_at=NOW() WHERE id=$5 AND contract_id=$6 RETURNING *`,
      [b.document_type ? parseDocumentType(b.document_type) : null, normalizeText(b.title) || null, normalizeText(b.description) || null, b.status ? parseDocumentStatus(b.status) : null, documentId, contractId]);
    if (!rows.length) return next(createHttpError(404, 'Document not found'));
    await recordContractLog(pool, { contractId, action: 'contract_document_updated', actorId: req.user?.id || null, details: { document_id: documentId } }); res.json(rows[0]);
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to update document')); }
};
const addContractDocumentVersion = async (req, res, next) => {
  if (!canManageContracts(req)) return next(createHttpError(403, 'You are not authorized to manage contract documents'));
  const contractId = Number(req.params.id); const documentId = Number(req.params.documentId); if (!Number.isInteger(contractId) || !Number.isInteger(documentId)) return next(createHttpError(400, 'Invalid id'));
  const client = await pool.connect();
  try { await ensureContractsPhaseThreeTables(); await client.query('BEGIN');
    const { rows: docs } = await client.query('SELECT * FROM contract_documents WHERE id=$1 AND contract_id=$2 FOR UPDATE', [documentId, contractId]); if (!docs.length) return next(createHttpError(404, 'Document not found'));
    const { rows: nextVersionRows } = await client.query('SELECT COALESCE(MAX(version_number),0)+1 AS next_number FROM contract_document_versions WHERE document_id=$1', [documentId]);
    const markCurrent = req.body?.is_current !== false;
    if (markCurrent) await client.query('UPDATE contract_document_versions SET is_current=FALSE WHERE document_id=$1', [documentId]);
    const { rows } = await client.query(`INSERT INTO contract_document_versions (document_id,contract_id,version_number,file_name,file_url,storage_path,mime_type,file_size,checksum,uploaded_by,is_current,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [documentId, contractId, Number(nextVersionRows[0].next_number), normalizeText(req.body?.file_name) || null, normalizeText(req.body?.file_url) || null, normalizeText(req.body?.storage_path) || null, normalizeText(req.body?.mime_type) || null, req.body?.file_size || null, normalizeText(req.body?.checksum) || null, req.user?.id || null, markCurrent, normalizeText(req.body?.notes) || null]);
    if (markCurrent) await client.query('UPDATE contract_documents SET current_version_id=$1, updated_at=NOW() WHERE id=$2', [rows[0].id, documentId]);
    await recordContractLog(client, { contractId, action: 'contract_document_version_added', actorId: req.user?.id || null, details: { document_id: documentId, version_id: rows[0].id } });
    await client.query('COMMIT'); res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err.statusCode ? err : createHttpError(500, 'Failed to add version')); } finally { client.release(); }
};
const markContractDocumentVersionCurrent = async (req, res, next) => {
  if (!canManageContracts(req)) return next(createHttpError(403, 'You are not authorized to manage contract documents'));
  const contractId = Number(req.params.id); const documentId = Number(req.params.documentId); const versionId = Number(req.params.versionId);
  if (![contractId, documentId, versionId].every(Number.isInteger)) return next(createHttpError(400, 'Invalid id'));
  const client = await pool.connect();
  try { await ensureContractsPhaseThreeTables(); await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM contract_document_versions WHERE id=$1 AND document_id=$2 AND contract_id=$3', [versionId, documentId, contractId]); if (!rows.length) return next(createHttpError(404, 'Version not found'));
    await client.query('UPDATE contract_document_versions SET is_current=FALSE WHERE document_id=$1', [documentId]);
    await client.query('UPDATE contract_document_versions SET is_current=TRUE WHERE id=$1', [versionId]);
    await client.query('UPDATE contract_documents SET current_version_id=$1, updated_at=NOW() WHERE id=$2 AND contract_id=$3', [versionId, documentId, contractId]);
    await recordContractLog(client, { contractId, action: 'contract_document_version_current_changed', actorId: req.user?.id || null, details: { document_id: documentId, version_id: versionId } });
    await client.query('COMMIT'); res.json({ message: 'Current version updated' });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err.statusCode ? err : createHttpError(500, 'Failed to mark current version')); } finally { client.release(); }
};
const archiveContractDocument = async (req, res, next) => {
  if (!canManageContracts(req)) return next(createHttpError(403, 'You are not authorized to manage contract documents'));
  const contractId = Number(req.params.id); const documentId = Number(req.params.documentId);
  if (!Number.isInteger(contractId) || !Number.isInteger(documentId)) return next(createHttpError(400, 'Invalid id'));
  try {
    await ensureContractsPhaseThreeTables();
    const { rows } = await pool.query('UPDATE contract_documents SET status=$1, updated_at=NOW() WHERE id=$2 AND contract_id=$3 RETURNING *', ['archived', documentId, contractId]);
    if (!rows.length) return next(createHttpError(404, 'Document not found'));
    await recordContractLog(pool, { contractId, action: 'contract_document_archived', actorId: req.user?.id || null, details: { document_id: documentId } });
    res.json(rows[0]);
  } catch (err) { next(err.statusCode ? err : createHttpError(500, 'Failed to archive document')); }
};
const deleteContractDocument = async (req, res, next) => archiveContractDocument(req, res, next);
const addDaysToDate = (dateValue, days) => { const d = new Date(dateValue); d.setDate(d.getDate() + Number(days || 0)); return d.toISOString().slice(0,10); };
const calculateNextDueDate = ({ dueDate, recurrence, recurrenceInterval }) => {
  if (!dueDate || recurrence === 'none') return null;
  const i = Number(recurrenceInterval) || 1;
  if (recurrence === 'daily') return addDaysToDate(dueDate, i);
  if (recurrence === 'weekly') return addDaysToDate(dueDate, 7 * i);
  if (recurrence === 'monthly') return addDaysToDate(dueDate, 30 * i);
  if (recurrence === 'quarterly') return addDaysToDate(dueDate, 90 * i);
  if (recurrence === 'semiannual') return addDaysToDate(dueDate, 182 * i);
  if (recurrence === 'annual') return addDaysToDate(dueDate, 365 * i);
  if (recurrence === 'custom' && i > 0) return addDaysToDate(dueDate, i);
  return null;
};
const withComputedOverdueStatus = row => {
  const due = row?.due_date ? new Date(row.due_date) : null; const today = new Date(); today.setHours(0,0,0,0);
  const computed = (due && due < today && ['open','in_progress'].includes(row.status)) ? 'overdue' : row.status;
  return { ...row, computed_status: computed };
};
const ensurePendingRenewalEvent = async (client, { contractId, renewalDate, noticeDays = 90, renewalType = null, actorId = null }) => {
  if (!renewalDate) return;
  const alertDate = addDaysToDate(renewalDate, -Number(noticeDays || 90));
  const { rows } = await client.query(`SELECT id FROM contract_renewal_events WHERE contract_id=$1 AND renewal_date=$2 AND status='pending' LIMIT 1`, [contractId, renewalDate]);
  if (rows.length) {
    await client.query(`UPDATE contract_renewal_events SET notice_days=$1, alert_date=$2, renewal_type=COALESCE($3,renewal_type), updated_at=NOW() WHERE id=$4`, [noticeDays, alertDate, renewalType, rows[0].id]);
    await recordContractLog(client, { contractId, action: 'contract_renewal_event_auto_updated', actorId, details: { renewal_event_id: rows[0].id } });
  } else {
    const ins = await client.query(`INSERT INTO contract_renewal_events (contract_id,renewal_type,renewal_date,notice_days,alert_date,status,created_by) VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING id`, [contractId, renewalType, renewalDate, noticeDays, alertDate, actorId]);
    await recordContractLog(client, { contractId, action: 'contract_renewal_event_auto_created', actorId, details: { renewal_event_id: ins.rows[0].id } });
  }
};
const canMutateObligation = (req, row) => canManageContracts(req) || Number(row?.owner_user_id) === Number(req.user?.id);
const listContractObligations = async (req,res,next)=>{ const contractId=Number(req.params.id); if(!Number.isInteger(contractId)) return next(createHttpError(400,'Invalid contract id')); try{ await ensureContractsPhaseFourTables(); const c=['contract_id=$1']; const v=[contractId];
  for (const [k,col] of [['status','status'],['owner_user_id','owner_user_id'],['obligation_type','obligation_type']]) if (req.query?.[k]) { v.push(req.query[k]); c.push(`${col}=$${v.length}`); }
  if (req.query?.due_from){ v.push(req.query.due_from); c.push(`due_date >= $${v.length}`);} if(req.query?.due_to){ v.push(req.query.due_to); c.push(`due_date <= $${v.length}`);}
  const {rows}=await pool.query(`SELECT * FROM contract_obligations WHERE ${c.join(' AND ')} ORDER BY due_date NULLS LAST, id DESC`,v); res.json(rows.map(withComputedOverdueStatus)); }catch(err){next(createHttpError(500,'Failed to list obligations'));}};
const createContractObligation = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id); const b=req.body||{}; if(!normalizeText(b.title)) return next(createHttpError(400,'title is required'));
  try{ await ensureContractsPhaseFourTables(); const recurrence=normalizeText(b.recurrence||'none').toLowerCase(); const type=normalizeText(b.obligation_type||'general').toLowerCase(); const priority=normalizeText(b.priority||'medium').toLowerCase(); const status=normalizeText(b.status||'open').toLowerCase();
    if(!OBLIGATION_RECURRENCES.includes(recurrence)||!OBLIGATION_TYPES.includes(type)||!OBLIGATION_PRIORITIES.includes(priority)||!OBLIGATION_STATUSES.includes(status)) return next(createHttpError(400,'Invalid enum value'));
    const dueDate=b.due_date||null; const nextDueDate=calculateNextDueDate({dueDate,recurrence,recurrenceInterval:b.recurrence_interval});
    const {rows}=await pool.query(`INSERT INTO contract_obligations (contract_id,title,description,obligation_type,owner_user_id,owner_department_id,due_date,recurrence,recurrence_interval,next_due_date,evidence_required,evidence_document_id,priority,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [contractId,normalizeText(b.title),normalizeText(b.description)||null,type,b.owner_user_id||null,b.owner_department_id||null,dueDate,recurrence,b.recurrence_interval||null,nextDueDate,Boolean(b.evidence_required),b.evidence_document_id||null,priority,status,req.user?.id||null]);
    await recordContractLog(pool,{contractId,action:'contract_obligation_created',actorId:req.user?.id||null,details:{obligation_id:rows[0].id}}); res.status(201).json(withComputedOverdueStatus(rows[0])); }catch(err){ next(createHttpError(500,'Failed to create obligation')); }};
const getContractObligation = async (req,res,next)=>{ const contractId=Number(req.params.id),obligationId=Number(req.params.obligationId); if(!Number.isInteger(contractId)||!Number.isInteger(obligationId)) return next(createHttpError(400,'Invalid id')); try{ await ensureContractsPhaseFourTables(); const {rows}=await pool.query('SELECT * FROM contract_obligations WHERE id=$1 AND contract_id=$2',[obligationId,contractId]); if(!rows.length) return next(createHttpError(404,'Obligation not found')); res.json(withComputedOverdueStatus(rows[0])); }catch{ next(createHttpError(500,'Failed to fetch obligation')); }};
const patchContractObligation = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id),obligationId=Number(req.params.obligationId); const b=req.body||{};
  try{ const {rows:cur}=await pool.query('SELECT * FROM contract_obligations WHERE id=$1 AND contract_id=$2',[obligationId,contractId]); if(!cur.length) return next(createHttpError(404,'Obligation not found')); const r=normalizeText(b.recurrence||cur[0].recurrence).toLowerCase(); const d=b.due_date||cur[0].due_date; const nextDueDate=calculateNextDueDate({dueDate:d,recurrence:r,recurrenceInterval:b.recurrence_interval ?? cur[0].recurrence_interval});
    const {rows}=await pool.query(`UPDATE contract_obligations SET title=COALESCE($1,title),description=COALESCE($2,description),obligation_type=COALESCE($3,obligation_type),owner_user_id=COALESCE($4,owner_user_id),owner_department_id=COALESCE($5,owner_department_id),due_date=COALESCE($6,due_date),recurrence=COALESCE($7,recurrence),recurrence_interval=COALESCE($8,recurrence_interval),next_due_date=$9,evidence_required=COALESCE($10,evidence_required),evidence_document_id=COALESCE($11,evidence_document_id),priority=COALESCE($12,priority),status=COALESCE($13,status),updated_at=NOW() WHERE id=$14 RETURNING *`,
      [normalizeText(b.title)||null,normalizeText(b.description)||null,b.obligation_type||null,b.owner_user_id||null,b.owner_department_id||null,b.due_date||null,b.recurrence||null,b.recurrence_interval||null,nextDueDate,b.evidence_required,b.evidence_document_id||null,b.priority||null,b.status||null,obligationId]);
    await recordContractLog(pool,{contractId,action:'contract_obligation_updated',actorId:req.user?.id||null,details:{obligation_id:obligationId}}); res.json(withComputedOverdueStatus(rows[0])); }catch{ next(createHttpError(500,'Failed to update obligation')); }};
const completeContractObligation = async (req,res,next)=>{ const contractId=Number(req.params.id),obligationId=Number(req.params.obligationId); const client=await pool.connect(); try{ await client.query('BEGIN'); const {rows}=await client.query('SELECT * FROM contract_obligations WHERE id=$1 AND contract_id=$2 FOR UPDATE',[obligationId,contractId]); if(!rows.length) return next(createHttpError(404,'Obligation not found')); const o=rows[0]; if(!canMutateObligation(req,o)) return next(createHttpError(403,'Not authorized'));
  await client.query(`UPDATE contract_obligations SET status='completed', completion_notes=$1, completed_at=NOW(), completed_by=$2, updated_at=NOW() WHERE id=$3`,[normalizeText(req.body?.completion_notes)||null,req.user?.id||null,obligationId]);
  if(o.recurrence && o.recurrence!=='none' && o.next_due_date){ const n=calculateNextDueDate({dueDate:o.next_due_date,recurrence:o.recurrence,recurrenceInterval:o.recurrence_interval}); await client.query(`INSERT INTO contract_obligations (contract_id,title,description,obligation_type,owner_user_id,owner_department_id,due_date,recurrence,recurrence_interval,next_due_date,evidence_required,evidence_document_id,priority,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',$14)`,[o.contract_id,o.title,o.description,o.obligation_type,o.owner_user_id,o.owner_department_id,o.next_due_date,o.recurrence,o.recurrence_interval,n,o.evidence_required,o.evidence_document_id,o.priority,req.user?.id||null]); }
  await recordContractLog(client,{contractId,action:'contract_obligation_completed',actorId:req.user?.id||null,details:{obligation_id:obligationId}}); await client.query('COMMIT'); res.json({message:'Obligation completed'});}catch(e){await client.query('ROLLBACK').catch(()=>{}); next(createHttpError(500,'Failed to complete obligation'));}finally{client.release();}};
const waiveContractObligation = async (req,res,next)=>{ const contractId=Number(req.params.id),obligationId=Number(req.params.obligationId); if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); try{ const {rows}=await pool.query(`UPDATE contract_obligations SET status='waived', completion_notes=$1, updated_at=NOW() WHERE id=$2 AND contract_id=$3 RETURNING *`,[normalizeText(req.body?.notes)||null,obligationId,contractId]); if(!rows.length) return next(createHttpError(404,'Obligation not found')); await recordContractLog(pool,{contractId,action:'contract_obligation_waived',actorId:req.user?.id||null,details:{obligation_id:obligationId}}); res.json(rows[0]); }catch{ next(createHttpError(500,'Failed')); }};
const cancelContractObligation = async (req,res,next)=>{ const contractId=Number(req.params.id),obligationId=Number(req.params.obligationId); if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); try{ const {rows}=await pool.query(`UPDATE contract_obligations SET status='cancelled', completion_notes=$1, updated_at=NOW() WHERE id=$2 AND contract_id=$3 RETURNING *`,[normalizeText(req.body?.notes)||null,obligationId,contractId]); if(!rows.length) return next(createHttpError(404,'Obligation not found')); await recordContractLog(pool,{contractId,action:'contract_obligation_cancelled',actorId:req.user?.id||null,details:{obligation_id:obligationId}}); res.json(rows[0]); }catch{ next(createHttpError(500,'Failed')); }};
const listDueSoonContractObligations = async (req,res,next)=>{ try{ await ensureContractsPhaseFourTables(); const days=Math.max(1,Number(req.query?.days)||30); const {rows}=await pool.query(`SELECT * FROM contract_obligations WHERE status IN ('open','in_progress','overdue') AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + ($1::int * INTERVAL '1 day') ORDER BY due_date ASC`,[days]); res.json(rows.map(withComputedOverdueStatus)); }catch{ next(createHttpError(500,'Failed')); }};
const listContractRenewalEvents = async (req,res,next)=>{ const contractId=Number(req.params.id); try{ await ensureContractsPhaseFourTables(); const {rows}=await pool.query('SELECT * FROM contract_renewal_events WHERE contract_id=$1 ORDER BY renewal_date DESC NULLS LAST',[contractId]); res.json(rows);}catch{next(createHttpError(500,'Failed'));}};
const createContractRenewalEvent = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id); const b=req.body||{}; try{ const nd=Number(b.notice_days||90); const ad=b.renewal_date?addDaysToDate(b.renewal_date,-nd):null; const {rows}=await pool.query(`INSERT INTO contract_renewal_events (contract_id,renewal_type,renewal_date,notice_days,alert_date,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[contractId,normalizeText(b.renewal_type)||null,b.renewal_date||null,nd,ad,normalizeText(b.status||'pending').toLowerCase(),req.user?.id||null]); await recordContractLog(pool,{contractId,action:'contract_renewal_event_created',actorId:req.user?.id||null,details:{renewal_event_id:rows[0].id}}); res.status(201).json(rows[0]); }catch{ next(createHttpError(500,'Failed')); }};
const updateContractRenewalEvent = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id), renewalEventId=Number(req.params.renewalEventId); const b=req.body||{}; try{ const nd=Number(b.notice_days||90); const ad=b.renewal_date?addDaysToDate(b.renewal_date,-nd):null; const {rows}=await pool.query(`UPDATE contract_renewal_events SET renewal_type=COALESCE($1,renewal_type),renewal_date=COALESCE($2,renewal_date),notice_days=COALESCE($3,notice_days),alert_date=COALESCE($4,alert_date),status=COALESCE($5,status),decision_notes=COALESCE($6,decision_notes),updated_at=NOW() WHERE id=$7 AND contract_id=$8 RETURNING *`,[normalizeText(b.renewal_type)||null,b.renewal_date||null,b.notice_days||null,ad,b.status||null,normalizeText(b.decision_notes)||null,renewalEventId,contractId]); if(!rows.length) return next(createHttpError(404,'Renewal event not found')); await recordContractLog(pool,{contractId,action:'contract_renewal_event_updated',actorId:req.user?.id||null,details:{renewal_event_id:renewalEventId}}); res.json(rows[0]); }catch{ next(createHttpError(500,'Failed')); }};
const decideContractRenewalEvent = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id), renewalEventId=Number(req.params.renewalEventId); const d=normalizeText(req.body?.decision).toLowerCase(); const map={renew:'renewed',do_not_renew:'not_renewed',renegotiate:'under_review',terminate:'completed',extend_temporarily:'under_review'}; if(!RENEWAL_DECISIONS.includes(d)) return next(createHttpError(400,'Invalid decision')); try{ const {rows}=await pool.query(`UPDATE contract_renewal_events SET decision=$1,decision_notes=$2,decided_by=$3,decided_at=NOW(),status=$4,updated_at=NOW() WHERE id=$5 AND contract_id=$6 RETURNING *`,[d,normalizeText(req.body?.decision_notes)||null,req.user?.id||null,map[d],renewalEventId,contractId]); if(!rows.length) return next(createHttpError(404,'Renewal event not found')); await recordContractLog(pool,{contractId,action:'contract_renewal_decision_recorded',actorId:req.user?.id||null,details:{renewal_event_id:renewalEventId,decision:d}}); res.json(rows[0]); }catch{ next(createHttpError(500,'Failed')); }};
const listDueSoonContractRenewals = async (req,res,next)=>{ try{ const days=Math.max(1,Number(req.query?.days)||90); const {rows}=await pool.query(`SELECT * FROM contract_renewal_events WHERE alert_date IS NOT NULL AND alert_date <= CURRENT_DATE + ($1::int * INTERVAL '1 day') ORDER BY alert_date ASC`,[days]); res.json(rows);}catch{ next(createHttpError(500,'Failed')); }};
const ensureContractsPhaseSixTables = (()=>{let ensured=false,p=null; return async()=>{ if(ensured) return; if(!p) p=(async()=>{ await pool.query(`CREATE TABLE IF NOT EXISTS contract_risk_assessments (id BIGSERIAL PRIMARY KEY, contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, risk_score INTEGER NOT NULL DEFAULT 0, risk_level TEXT NOT NULL DEFAULT 'low', risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb, assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), assessed_by BIGINT REFERENCES users(id) ON DELETE SET NULL, assessment_source TEXT NOT NULL DEFAULT 'system', notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT contract_risk_assessments_level_check CHECK (risk_level IN ('low','medium','high','critical')), CONSTRAINT contract_risk_assessments_source_check CHECK (assessment_source IN ('system','manual','ai','scheduled')))`); await pool.query(`CREATE INDEX IF NOT EXISTS contract_risk_assessments_contract_id_idx ON contract_risk_assessments(contract_id)`); await pool.query(`CREATE INDEX IF NOT EXISTS contract_risk_assessments_risk_level_idx ON contract_risk_assessments(risk_level)`); await pool.query(`CREATE INDEX IF NOT EXISTS contract_risk_assessments_assessed_at_idx ON contract_risk_assessments(assessed_at DESC)`); ensured=true; })().finally(()=>p=null); await p; };})();
const ensureContractsPhaseSevenTables = (()=>{let ensured=false,p=null; return async()=>{ if(ensured) return; if(!p) p=(async()=>{ await pool.query(`CREATE TABLE IF NOT EXISTS contract_ai_extractions (id BIGSERIAL PRIMARY KEY, contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, document_id BIGINT REFERENCES contract_documents(id) ON DELETE SET NULL, document_version_id BIGINT REFERENCES contract_document_versions(id) ON DELETE SET NULL, extraction_status TEXT NOT NULL DEFAULT 'pending', provider TEXT, model TEXT, extracted_parties JSONB NOT NULL DEFAULT '{}'::jsonb, extracted_dates JSONB NOT NULL DEFAULT '{}'::jsonb, extracted_value JSONB NOT NULL DEFAULT '{}'::jsonb, extracted_payment_terms JSONB NOT NULL DEFAULT '{}'::jsonb, extracted_renewal_clause JSONB NOT NULL DEFAULT '{}'::jsonb, extracted_termination_clause JSONB NOT NULL DEFAULT '{}'::jsonb, extracted_obligations JSONB NOT NULL DEFAULT '[]'::jsonb, extracted_risks JSONB NOT NULL DEFAULT '[]'::jsonb, summary TEXT, confidence_score NUMERIC(5,2), raw_json JSONB NOT NULL DEFAULT '{}'::jsonb, error_message TEXT, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT contract_ai_extractions_status_check CHECK (extraction_status IN ('pending','processing','completed','failed','skipped')))`); await pool.query(`CREATE INDEX IF NOT EXISTS contract_ai_extractions_contract_id_idx ON contract_ai_extractions(contract_id)`); await pool.query(`CREATE INDEX IF NOT EXISTS contract_ai_extractions_status_idx ON contract_ai_extractions(extraction_status)`); ensured=true; })().finally(()=>p=null); await p; };})();
const hasAiProviderConfig = ()=>Boolean(process.env.OPENAI_API_KEY || (process.env.AI_PROVIDER && process.env.AI_MODEL));
const runAiExtractionPlaceholder = async ({ contractId }) => ({ provider: process.env.AI_PROVIDER || 'placeholder', model: process.env.AI_MODEL || 'placeholder', summary: `AI extraction placeholder for contract ${contractId}.`, extracted_parties:{}, extracted_dates:{}, extracted_value:{}, extracted_payment_terms:{}, extracted_renewal_clause:{}, extracted_termination_clause:{}, extracted_obligations:[], extracted_risks:[], raw_json:{ placeholder:true }, confidence_score:null });
const factor=(code,label,severity,points,explanation,recommended_action)=>({code,label,severity,points,explanation,recommended_action});
const calculateContractRisk = (contract, data={})=>{ const f=[]; const add=(...a)=>f.push(factor(...a)); const today=new Date(); today.setHours(0,0,0,0);
 const docs=data.documents||[]; const renewals=data.renewals||[]; const invoices=data.invoices||[]; const obligations=data.obligations||[]; const consumptionTotal=Number(data.totalConsumed||0);
 if(['active','sent_for_signature','expiring_soon','renewed'].includes(contract.status) && !docs.some(d=>d.document_type==='signed_contract' && d.status==='active')) add('missing_signed_document','Missing signed contract document','high',20,'No active signed contract document found.','Upload and mark a signed_contract document.');
 if(docs.length && docs.some(d=>!d.current_version_id)) add('missing_current_document_version','Missing current document version','medium',10,'Some documents have no current version.','Set current version for all active documents.');
 if(['active','expiring_soon','renewed'].includes(contract.status) && contract.end_date && new Date(contract.end_date)<today) add('expired_but_active','Expired but active','critical',25,'Contract is past end date but still active-like status.','Archive, renew, or correct status immediately.');
 if(!contract.end_date) add('no_end_date','No end date','medium',15,'Contract has no end date.','Define contractual end date and review notice period.');
 if(contract.end_date){ const notice=Number(contract.renewal_notice_days||90); const d=(new Date(contract.end_date)-today)/86400000; if(d>=0&&d<=notice&&!renewals.some(r=>r.decision)) add('expiring_soon_without_renewal_decision','Expiring soon without renewal decision','high',15,'End date is near and no decision exists.','Record renewal decision and route approval.'); }
 if((contract.renewal_type||'').toLowerCase().includes('auto') && !renewals.length) add('auto_renewal_without_review','Auto-renewal without review','high',15,'Auto renewal configured with no review event.','Create renewal review event and decision.');
 if(!contract.contract_owner && !contract.contract_manager_id) add('missing_contract_owner_or_manager','Missing owner/manager','high',15,'Neither owner nor manager assigned.','Assign contract owner or manager.');
 if(!contract.end_user_department_id) add('missing_department','Missing department','medium',10,'No end-user department linked.','Link an owning department.');
 if(!contract.supplier_id) add('missing_supplier_link','Missing supplier link','medium',10,'No supplier linked to contract.','Link supplier record.');
 if(invoices.some(i=>i.matching_status==='failed')) add('invoice_matching_failed','Invoice matching failed','critical',25,'At least one invoice failed controls.','Resolve failed invoice flags before payment.');
 if(invoices.some(i=>i.matching_status==='warning')) add('invoice_matching_warning','Invoice matching warning','medium',10,'At least one invoice has matching warnings.','Review warning flags and approve exceptions.');
 if(invoices.some(i=>Array.isArray(i.matching_flags)&&i.matching_flags.includes('invoice_exceeds_remaining_contract_value'))) add('invoice_exceeds_remaining_value','Invoice exceeds remaining value','critical',25,'Invoice exceeded remaining contract value.','Reject/adjust invoice or amend contract.');
 const adv=Number(contract.payment_advance_percentage||0); if((adv>30)||((Number(contract.amount_paid||0)>0 && Number(contract.contract_value||0)>0 && (Number(contract.amount_paid)/Number(contract.contract_value))*100>30))) add('high_advance_payment','High advance payment','medium',10,'Advance payment exceeds 30%.','Require finance/legal review for advance terms.');
 const approvedInv=invoices.filter(i=>['approved','partially_paid','paid'].includes(i.status)).reduce((s,i)=>s+Number(i.net_payable_amount||0),0); if(Number(contract.contract_value||0)>0 && Math.max(consumptionTotal,approvedInv)>Number(contract.contract_value||0)) add('consumed_over_contract_value','Consumed over contract value','critical',30,'Consumption/approved invoices exceed contract value.','Stop further billing and amend contract value.');
 if(obligations.some(o=>o.computed_status==='overdue')) add('overdue_obligation','Overdue obligation','high',20,'At least one obligation is overdue.','Escalate and close overdue obligations.');
 if(obligations.some(o=>['open','in_progress'].includes(o.status)&&o.priority==='critical')) add('critical_open_obligation','Critical open obligation','high',15,'Critical obligation remains open.','Prioritize immediate completion.');
 if(!normalizeText(contract.termination_exit_terms)) add('missing_termination_clause','Missing termination clause','medium',10,'Termination/exit terms are empty.','Add termination and exit terms.');
 if(!normalizeText(contract.penalties_incentives) && !normalizeText(contract.payment_penalty_rate_percent)) add('missing_penalty_clause','Missing penalty clause','medium',10,'Penalty/incentive terms are missing.','Define penalties/incentives for non-performance.');
 if(!normalizeText(contract.compliance_legal_terms)) add('missing_compliance_terms','Missing compliance terms','medium',10,'Compliance/legal terms are missing.','Add compliance and legal obligations.');
 let score=Math.min(100,f.reduce((s,x)=>s+x.points,0)); const level=score>=75?'critical':score>=50?'high':score>=25?'medium':'low'; return {risk_score:score,risk_level:level,risk_factors:f}; };
const INVOICE_STATUSES = ['pending','under_review','approved','partially_paid','paid','rejected','disputed','cancelled'];
const MATCHING_STATUSES = ['not_checked','matched','warning','failed'];
const PAYMENT_STATUSES = ['pending','approved','paid','rejected','cancelled'];
const CONSUMPTION_SOURCES = ['manual','invoice','purchase_order','goods_receipt','service_entry','adjustment'];
const ensureContractsPhaseFiveTables = (() => { let ensured=false; let p=null; return async()=>{ if(ensured) return; if(!p) p=(async()=>{
  await pool.query(`CREATE TABLE IF NOT EXISTS contract_invoices (id BIGSERIAL PRIMARY KEY, contract_id BIGINT REFERENCES contracts(id) ON DELETE SET NULL, supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL, invoice_number TEXT NOT NULL, invoice_date DATE, due_date DATE, received_date DATE, amount NUMERIC(18,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'IQD', tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0, retention_amount NUMERIC(18,2) NOT NULL DEFAULT 0, penalty_amount NUMERIC(18,2) NOT NULL DEFAULT 0, net_payable_amount NUMERIC(18,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', matching_status TEXT NOT NULL DEFAULT 'not_checked', matching_flags JSONB NOT NULL DEFAULT '[]'::jsonb, notes TEXT, document_id BIGINT REFERENCES contract_documents(id) ON DELETE SET NULL, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS contract_payments (id BIGSERIAL PRIMARY KEY, contract_id BIGINT REFERENCES contracts(id) ON DELETE SET NULL, invoice_id BIGINT REFERENCES contract_invoices(id) ON DELETE SET NULL, payment_reference TEXT, payment_date DATE, amount NUMERIC(18,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'IQD', method TEXT, status TEXT NOT NULL DEFAULT 'pending', notes TEXT, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS contract_consumption (id BIGSERIAL PRIMARY KEY, contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, source_type TEXT NOT NULL DEFAULT 'manual', source_id BIGINT, consumption_date DATE NOT NULL DEFAULT CURRENT_DATE, description TEXT, amount NUMERIC(18,2) NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'IQD', invoice_id BIGINT REFERENCES contract_invoices(id) ON DELETE SET NULL, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const q of [`CREATE INDEX IF NOT EXISTS contract_invoices_contract_id_idx ON contract_invoices(contract_id)`,`CREATE INDEX IF NOT EXISTS contract_invoices_supplier_id_idx ON contract_invoices(supplier_id)`,`CREATE INDEX IF NOT EXISTS contract_invoices_invoice_number_idx ON contract_invoices(invoice_number)`,`CREATE INDEX IF NOT EXISTS contract_invoices_status_idx ON contract_invoices(status)`,`CREATE INDEX IF NOT EXISTS contract_invoices_matching_status_idx ON contract_invoices(matching_status)`,`CREATE INDEX IF NOT EXISTS contract_payments_contract_id_idx ON contract_payments(contract_id)`,`CREATE INDEX IF NOT EXISTS contract_payments_invoice_id_idx ON contract_payments(invoice_id)`,`CREATE INDEX IF NOT EXISTS contract_payments_status_idx ON contract_payments(status)`,`CREATE INDEX IF NOT EXISTS contract_consumption_contract_id_idx ON contract_consumption(contract_id)`,`CREATE INDEX IF NOT EXISTS contract_consumption_invoice_id_idx ON contract_consumption(invoice_id)`,`CREATE INDEX IF NOT EXISTS contract_consumption_consumption_date_idx ON contract_consumption(consumption_date)`]) await pool.query(q);
  ensured=true; })().finally(()=>p=null); await p; };})();
const evaluateContractInvoiceMatching = ({invoice, contract, previousInvoices=[], payments=[]}) => { const flags=[]; const amt=Number(invoice.amount||0), retention=Number(invoice.retention_amount||0), penalty=Number(invoice.penalty_amount||0), tax=Number(invoice.tax_amount||0), discount=Number(invoice.discount_amount||0); const net=Number((amt+tax-discount-retention-penalty).toFixed(2));
 if(!contract) flags.push('missing_contract'); if(!invoice.supplier_id) flags.push('missing_supplier'); if(!invoice.invoice_date) flags.push('missing_invoice_date'); if(amt<=0) flags.push('negative_or_zero_invoice_amount'); if(retention>amt) flags.push('retention_amount_exceeds_invoice'); if(penalty>amt) flags.push('penalty_amount_exceeds_invoice');
 if(invoice.due_date && invoice.invoice_date && new Date(invoice.due_date)<new Date(invoice.invoice_date)) flags.push('due_date_before_invoice_date');
 if(previousInvoices.some(i=>i.invoice_number===invoice.invoice_number && Number(i.supplier_id||0)===Number(invoice.supplier_id||0) && Number(i.id||0)!==Number(invoice.id||0))) flags.push('duplicate_invoice_number');
 if(contract){ if(contract.end_date && invoice.invoice_date && new Date(invoice.invoice_date)>new Date(contract.end_date)) flags.push('expired_contract_billing'); if(!['active','expiring_soon','renewed'].includes(contract.status)) flags.push('inactive_or_invalid_contract_status'); if(contract.currency && invoice.currency && contract.currency!==invoice.currency) flags.push('currency_mismatch'); const cv=Number(contract.contract_value||0); const sum=previousInvoices.filter(i=>!['cancelled','rejected'].includes(i.status)).reduce((s,i)=>s+Number(i.net_payable_amount||0),0); const remaining=cv-sum; if(cv>0 && net>cv) flags.push('invoice_exceeds_contract_value'); if(cv>0 && net>remaining) flags.push('invoice_exceeds_remaining_contract_value'); if(contract.payment_period && invoice.invoice_date && invoice.due_date){ const maxDays=parseInt(String(contract.payment_period).match(/\d+/)?.[0]||'0',10); if(maxDays>0 && (new Date(invoice.due_date)-new Date(invoice.invoice_date))/86400000>maxDays) flags.push('payment_terms_exceeded'); } }
 const paid=payments.filter(p=>p.status==='paid').reduce((s,p)=>s+Number(p.amount||0),0); if(net>0 && paid>=net) flags.push('already_fully_paid');
 const severe=['duplicate_invoice_number','missing_contract','invoice_exceeds_contract_value','invoice_exceeds_remaining_contract_value','negative_or_zero_invoice_amount','retention_amount_exceeds_invoice','penalty_amount_exceeds_invoice']; const warning=['expired_contract_billing','inactive_or_invalid_contract_status','currency_mismatch','missing_invoice_date','due_date_before_invoice_date','payment_terms_exceeded','missing_supplier'];
 const status=flags.some(f=>severe.includes(f))?'failed':(flags.some(f=>warning.includes(f))?'warning':'matched'); return { matching_status: status, matching_flags: flags, net_payable_amount: net }; };
const listContractInvoices = async (req,res,next)=>{ try{ await ensureContractsPhaseFiveTables(); const {rows}=await pool.query('SELECT * FROM contract_invoices WHERE contract_id=$1 ORDER BY created_at DESC',[Number(req.params.id)]); res.json(rows);}catch{next(createHttpError(500,'Failed'));}};
const createContractInvoice = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id); const b=req.body||{}; if(!normalizeText(b.invoice_number)) return next(createHttpError(400,'invoice_number required')); if(Number(b.amount)<=0) return next(createHttpError(400,'amount must be > 0')); try{ await ensureContractsPhaseFiveTables(); const {rows:c}=await pool.query('SELECT * FROM contracts WHERE id=$1',[contractId]); const contract=c[0]||null; const supplierId=b.supplier_id || contract?.supplier_id || null; const dueDate=b.due_date || null; const invoice={...b,contract_id:contractId,supplier_id:supplierId,due_date:dueDate}; const {rows:prev}=await pool.query('SELECT * FROM contract_invoices WHERE contract_id=$1',[contractId]); const match=evaluateContractInvoiceMatching({invoice,contract,previousInvoices:prev,payments:[]}); const {rows}=await pool.query(`INSERT INTO contract_invoices (contract_id,supplier_id,invoice_number,invoice_date,due_date,received_date,amount,currency,tax_amount,discount_amount,retention_amount,penalty_amount,net_payable_amount,status,matching_status,matching_flags,notes,document_id,created_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,NOW()) RETURNING *`,[contractId,supplierId,normalizeText(b.invoice_number),b.invoice_date||null,dueDate,b.received_date||null,b.amount,b.currency||contract?.currency||'IQD',b.tax_amount||0,b.discount_amount||0,b.retention_amount||0,b.penalty_amount||0,match.net_payable_amount,b.status||'pending',match.matching_status,JSON.stringify(match.matching_flags),normalizeText(b.notes)||null,b.document_id||null,req.user?.id||null]); await recordContractLog(pool,{contractId,action:'contract_invoice_created',actorId:req.user?.id||null,details:{invoice_id:rows[0].id,matching_status:match.matching_status}}); res.status(201).json(rows[0]); }catch(e){next(createHttpError(500,'Failed'));}};
const getContractInvoice = async (req,res,next)=>{ const contractId=Number(req.params.id), invoiceId=Number(req.params.invoiceId); try{ const {rows}=await pool.query('SELECT * FROM contract_invoices WHERE id=$1 AND contract_id=$2',[invoiceId,contractId]); if(!rows.length) return next(createHttpError(404,'Invoice not found')); const pays=await pool.query('SELECT * FROM contract_payments WHERE invoice_id=$1 ORDER BY created_at DESC',[invoiceId]); const cons=await pool.query('SELECT * FROM contract_consumption WHERE invoice_id=$1 ORDER BY consumption_date DESC',[invoiceId]); res.json({...rows[0],payments:pays.rows,consumption:cons.rows}); }catch{next(createHttpError(500,'Failed'));}};
const runInvoiceMatch = async (contractId, invoiceId)=>{ const inv=(await pool.query('SELECT * FROM contract_invoices WHERE id=$1 AND contract_id=$2',[invoiceId,contractId])).rows[0]; const contract=(await pool.query('SELECT * FROM contracts WHERE id=$1',[contractId])).rows[0]||null; const prev=(await pool.query('SELECT * FROM contract_invoices WHERE contract_id=$1',[contractId])).rows; const pays=(await pool.query('SELECT * FROM contract_payments WHERE invoice_id=$1',[invoiceId])).rows; const m=evaluateContractInvoiceMatching({invoice:inv,contract,previousInvoices:prev,payments:pays}); const updated=(await pool.query('UPDATE contract_invoices SET net_payable_amount=$1, matching_status=$2, matching_flags=$3::jsonb, updated_at=NOW() WHERE id=$4 RETURNING *',[m.net_payable_amount,m.matching_status,JSON.stringify(m.matching_flags),invoiceId])).rows[0]; return updated; };
const updateContractInvoice = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id), invoiceId=Number(req.params.invoiceId); const b=req.body||{}; try{ await pool.query(`UPDATE contract_invoices SET invoice_number=COALESCE($1,invoice_number),invoice_date=COALESCE($2,invoice_date),due_date=COALESCE($3,due_date),received_date=COALESCE($4,received_date),amount=COALESCE($5,amount),currency=COALESCE($6,currency),tax_amount=COALESCE($7,tax_amount),discount_amount=COALESCE($8,discount_amount),retention_amount=COALESCE($9,retention_amount),penalty_amount=COALESCE($10,penalty_amount),status=COALESCE($11,status),notes=COALESCE($12,notes),updated_at=NOW() WHERE id=$13 AND contract_id=$14`,[b.invoice_number||null,b.invoice_date||null,b.due_date||null,b.received_date||null,b.amount||null,b.currency||null,b.tax_amount||null,b.discount_amount||null,b.retention_amount||null,b.penalty_amount||null,b.status||null,b.notes||null,invoiceId,contractId]); const u=await runInvoiceMatch(contractId,invoiceId); await recordContractLog(pool,{contractId,action:'contract_invoice_updated',actorId:req.user?.id||null,details:{invoice_id:invoiceId}}); res.json(u);}catch{next(createHttpError(500,'Failed'));}};
const matchContractInvoice = async (req,res,next)=>{ const contractId=Number(req.params.id), invoiceId=Number(req.params.invoiceId); try{ const u=await runInvoiceMatch(contractId,invoiceId); await recordContractLog(pool,{contractId,action:'contract_invoice_matched',actorId:req.user?.id||null,details:{invoice_id:invoiceId}}); res.json(u);}catch{next(createHttpError(500,'Failed'));}};
const updateContractInvoiceStatus = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id), invoiceId=Number(req.params.invoiceId), status=normalizeText(req.body?.status).toLowerCase(); if(!INVOICE_STATUSES.includes(status)) return next(createHttpError(400,'Invalid status')); try{ const {rows}=await pool.query('UPDATE contract_invoices SET status=$1,updated_at=NOW() WHERE id=$2 AND contract_id=$3 RETURNING *',[status,invoiceId,contractId]); if(!rows.length) return next(createHttpError(404,'Invoice not found')); await recordContractLog(pool,{contractId,action:'contract_invoice_status_changed',actorId:req.user?.id||null,details:{invoice_id:invoiceId,status}}); res.json(rows[0]); }catch{next(createHttpError(500,'Failed'));}};
const recalcInvoicePaymentStatus = async (invoiceId)=>{ const inv=(await pool.query('SELECT * FROM contract_invoices WHERE id=$1',[invoiceId])).rows[0]; if(!inv) return; const paid=(await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM contract_payments WHERE invoice_id=$1 AND status='paid'",[invoiceId])).rows[0].total; const total=Number(paid||0), net=Number(inv.net_payable_amount||0); const status= total<=0 ? (['pending','approved'].includes(inv.status)?inv.status:'approved') : (total+0.0001<net?'partially_paid':'paid'); await pool.query('UPDATE contract_invoices SET status=$1, updated_at=NOW() WHERE id=$2',[status,invoiceId]); };
const listContractPayments = async (req,res,next)=>{ try{ await ensureContractsPhaseFiveTables(); const {rows}=await pool.query('SELECT p.*, i.invoice_number FROM contract_payments p LEFT JOIN contract_invoices i ON i.id=p.invoice_id WHERE p.contract_id=$1 ORDER BY p.created_at DESC',[Number(req.params.id)]); res.json(rows);}catch{next(createHttpError(500,'Failed'));}};
const createContractPayment = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id); const b=req.body||{}; if(Number(b.amount)<=0) return next(createHttpError(400,'amount must be > 0')); try{ if(b.invoice_id){ const inv=(await pool.query('SELECT * FROM contract_invoices WHERE id=$1 AND contract_id=$2',[b.invoice_id,contractId])).rows[0]; if(!inv) return next(createHttpError(404,'Invoice not found')); const paid=(await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM contract_payments WHERE invoice_id=$1 AND status='paid'",[b.invoice_id])).rows[0].total; if(Number(paid)+Number(b.amount)>Number(inv.net_payable_amount||0)+0.0001) return next(createHttpError(400,'Payment exceeds invoice net payable')); }
 const {rows}=await pool.query(`INSERT INTO contract_payments (contract_id,invoice_id,payment_reference,payment_date,amount,currency,method,status,notes,created_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,[contractId,b.invoice_id||null,normalizeText(b.payment_reference)||null,b.payment_date||null,b.amount,b.currency||'IQD',normalizeText(b.method)||null,b.status||'pending',normalizeText(b.notes)||null,req.user?.id||null]); if(rows[0].invoice_id) await recalcInvoicePaymentStatus(rows[0].invoice_id); await recordContractLog(pool,{contractId,action:'contract_payment_created',actorId:req.user?.id||null,details:{payment_id:rows[0].id}}); res.status(201).json(rows[0]); }catch{next(createHttpError(500,'Failed'));}};
const updateContractPayment = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id), paymentId=Number(req.params.paymentId), b=req.body||{}; try{ const {rows}=await pool.query(`UPDATE contract_payments SET payment_reference=COALESCE($1,payment_reference),payment_date=COALESCE($2,payment_date),amount=COALESCE($3,amount),currency=COALESCE($4,currency),method=COALESCE($5,method),notes=COALESCE($6,notes),updated_at=NOW() WHERE id=$7 AND contract_id=$8 RETURNING *`,[b.payment_reference||null,b.payment_date||null,b.amount||null,b.currency||null,b.method||null,b.notes||null,paymentId,contractId]); if(!rows.length) return next(createHttpError(404,'Payment not found')); if(rows[0].invoice_id) await recalcInvoicePaymentStatus(rows[0].invoice_id); await recordContractLog(pool,{contractId,action:'contract_payment_updated',actorId:req.user?.id||null,details:{payment_id:paymentId}}); res.json(rows[0]); }catch{next(createHttpError(500,'Failed'));}};
const updateContractPaymentStatus = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id), paymentId=Number(req.params.paymentId), status=normalizeText(req.body?.status).toLowerCase(); if(!PAYMENT_STATUSES.includes(status)) return next(createHttpError(400,'Invalid status')); try{ const {rows}=await pool.query('UPDATE contract_payments SET status=$1,updated_at=NOW() WHERE id=$2 AND contract_id=$3 RETURNING *',[status,paymentId,contractId]); if(!rows.length) return next(createHttpError(404,'Payment not found')); if(rows[0].invoice_id) await recalcInvoicePaymentStatus(rows[0].invoice_id); await recordContractLog(pool,{contractId,action:'contract_payment_status_changed',actorId:req.user?.id||null,details:{payment_id:paymentId,status}}); res.json(rows[0]); }catch{next(createHttpError(500,'Failed'));}};
const listContractConsumptionEntries = async (req,res,next)=>{ try{ const {rows}=await pool.query('SELECT c.*, i.invoice_number FROM contract_consumption c LEFT JOIN contract_invoices i ON i.id=c.invoice_id WHERE c.contract_id=$1 ORDER BY c.consumption_date DESC',[Number(req.params.id)]); res.json(rows);}catch{next(createHttpError(500,'Failed'));}};
const createContractConsumptionEntry = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); const contractId=Number(req.params.id), b=req.body||{}; if(Number(b.amount)<=0) return next(createHttpError(400,'amount must be > 0')); if(b.source_type && !CONSUMPTION_SOURCES.includes(b.source_type)) return next(createHttpError(400,'Invalid source_type')); try{ const {rows}=await pool.query(`INSERT INTO contract_consumption (contract_id,source_type,source_id,consumption_date,description,amount,currency,invoice_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[contractId,b.source_type||'manual',b.source_id||null,b.consumption_date||null,normalizeText(b.description)||null,b.amount,b.currency||'IQD',b.invoice_id||null,req.user?.id||null]); await pool.query('UPDATE contracts SET actual_consumed_value = COALESCE((SELECT SUM(amount) FROM contract_consumption WHERE contract_id=$1),0), updated_at=NOW() WHERE id=$1',[contractId]); await recordContractLog(pool,{contractId,action:'contract_consumption_created',actorId:req.user?.id||null,details:{consumption_id:rows[0].id}}); res.status(201).json(rows[0]); }catch{next(createHttpError(500,'Failed'));}};
const getContractFinancialSummary = async (req,res,next)=>{ const contractId=Number(req.params.id); try{ const c=(await pool.query('SELECT id, contract_value, currency FROM contracts WHERE id=$1',[contractId])).rows[0]; if(!c) return next(createHttpError(404,'Contract not found')); const inv=(await pool.query("SELECT * FROM contract_invoices WHERE contract_id=$1",[contractId])).rows; const pay=(await pool.query("SELECT * FROM contract_payments WHERE contract_id=$1",[contractId])).rows; const cons=(await pool.query("SELECT * FROM contract_consumption WHERE contract_id=$1",[contractId])).rows; const totalInvoiced=inv.reduce((s,i)=>s+Number(i.amount||0),0); const totalApproved=inv.filter(i=>['approved','partially_paid','paid'].includes(i.status)).reduce((s,i)=>s+Number(i.net_payable_amount||0),0); const totalPaid=pay.filter(p=>p.status==='paid').reduce((s,p)=>s+Number(p.amount||0),0); const totalConsumed=cons.reduce((s,x)=>s+Number(x.amount||0),0); res.json({contract_value:Number(c.contract_value||0),currency:c.currency||'IQD',total_invoiced:totalInvoiced,total_approved_invoiced:totalApproved,total_paid:totalPaid,total_consumed:totalConsumed,remaining_contract_value:Number(c.contract_value||0)-inv.filter(i=>!['cancelled','rejected'].includes(i.status)).reduce((s,i)=>s+Number(i.net_payable_amount||0),0),open_invoice_count:inv.filter(i=>['pending','under_review','approved','partially_paid'].includes(i.status)).length,disputed_invoice_count:inv.filter(i=>i.status==='disputed').length,matching_failed_count:inv.filter(i=>i.matching_status==='failed').length,matching_warning_count:inv.filter(i=>i.matching_status==='warning').length,payment_status_summary:pay.reduce((a,p)=>((a[p.status]=(a[p.status]||0)+1),a),{})}); }catch{next(createHttpError(500,'Failed'));}};
const recalculateContractRisk = async (req,res,next)=>{ if(!canManageContracts(req)) return next(createHttpError(403,'Not authorized')); req.query={...(req.query||{}),persist:'true'}; const origJson=res.json.bind(res); res.json=async(data)=>{ await recordContractLog(pool,{contractId:Number(req.params.id),action:'contract_risk_recalculated',actorId:req.user?.id||null,details:{score:data.risk_score,level:data.risk_level,factor_count:(data.risk_factors||[]).length,notes:normalizeText(req.body?.notes)||null}}); return origJson(data); }; return getContractRisk(req,res,next); };
const getContractRiskHistory = async (req,res,next)=>{ try{ await ensureContractsPhaseSixTables(); const {rows}=await pool.query('SELECT * FROM contract_risk_assessments WHERE contract_id=$1 ORDER BY assessed_at DESC',[Number(req.params.id)]); res.json(rows);}catch{next(createHttpError(500,'Failed'));}};
const getContractRiskDashboard = async (req,res,next)=>{ try{ await ensureContractsPhaseSixTables(); const limit=Math.max(1,Math.min(50,Number(req.query?.limit)||10)); const cond=[]; const vals=[]; if(req.query?.department_id){vals.push(req.query.department_id); cond.push(`c.end_user_department_id=$${vals.length}`);} if(req.query?.supplier_id){vals.push(req.query.supplier_id); cond.push(`c.supplier_id=$${vals.length}`);} if(req.query?.status){vals.push(req.query.status); cond.push(`c.status=$${vals.length}`);} const where=cond.length?`WHERE ${cond.join(' AND ')}`:''; const {rows}=await pool.query(`SELECT a.*, c.title, c.status AS contract_status FROM contract_risk_assessments a JOIN LATERAL (SELECT * FROM contract_risk_assessments x WHERE x.contract_id=a.contract_id ORDER BY x.assessed_at DESC LIMIT 1) z ON z.id=a.id JOIN contracts c ON c.id=a.contract_id ${where}` , vals); const filtered=req.query?.risk_level?rows.filter(r=>r.risk_level===req.query.risk_level):rows; const total=filtered.length||0; const count=l=>filtered.filter(r=>r.risk_level===l).length; const avg=total?Number((filtered.reduce((s,r)=>s+Number(r.risk_score||0),0)/total).toFixed(2)):0; const top=[...filtered].sort((a,b)=>Number(b.risk_score)-Number(a.risk_score)).slice(0,limit); const freq={}; for(const r of filtered){ for(const f of (Array.isArray(r.risk_factors)?r.risk_factors:[])) freq[f.code]=(freq[f.code]||0)+1; } const common=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([code,count])=>({code,count}));
    res.json({total_contracts:total,low_count:count('low'),medium_count:count('medium'),high_count:count('high'),critical_count:count('critical'),average_risk_score:avg,top_risky_contracts:top,most_common_risk_factors:common,financial_risk_count:common.filter(x=>x.code.includes('invoice')||x.code.includes('consumed')||x.code.includes('payment')).reduce((s,x)=>s+x.count,0),obligation_risk_count:common.filter(x=>x.code.includes('obligation')).reduce((s,x)=>s+x.count,0),document_risk_count:common.filter(x=>x.code.includes('document')).reduce((s,x)=>s+x.count,0),renewal_risk_count:common.filter(x=>x.code.includes('renewal')||x.code.includes('expiring')).reduce((s,x)=>s+x.count,0)}); }catch{next(createHttpError(500,'Failed'));}};
const listHighRiskContracts = async (req,res,next)=>{ try{ const {rows}=await pool.query(`SELECT a.*, c.title FROM contract_risk_assessments a JOIN LATERAL (SELECT * FROM contract_risk_assessments x WHERE x.contract_id=a.contract_id ORDER BY x.assessed_at DESC LIMIT 1) z ON z.id=a.id JOIN contracts c ON c.id=a.contract_id WHERE a.risk_level IN ('high','critical') ORDER BY a.risk_score DESC`); res.json(rows.map(r=>({...r,main_factors:(r.risk_factors||[]).slice(0,3)}))); }catch{ next(createHttpError(500,'Failed')); }};
const requestContractAiExtraction = async (req,res,next)=>{ const contractId=Number(req.params.id); if(!Number.isInteger(contractId)) return next(createHttpError(400,'Invalid contract id')); let client; try{ await ensureContractsPhaseSevenTables(); client=await pool.connect(); await client.query('BEGIN'); const {rows:contracts}=await client.query('SELECT id FROM contracts WHERE id=$1',[contractId]); if(!contracts.length) return next(createHttpError(404,'Contract not found'));
  const base=[contractId, req.body?.document_id||null, req.body?.document_version_id||null, req.user?.id||null];
  if(!hasAiProviderConfig()){ const {rows}=await client.query(`INSERT INTO contract_ai_extractions (contract_id,document_id,document_version_id,extraction_status,error_message,created_by,updated_at) VALUES ($1,$2,$3,'skipped',$4,$5,NOW()) RETURNING *`,[...base,'AI extraction is prepared but no provider is configured yet.']); await recordContractLog(client,{contractId,action:'contract_ai_extraction_skipped',actorId:req.user?.id||null,details:{extraction_id:rows[0].id}}); await client.query('COMMIT'); return res.status(501).json({message:'AI extraction is prepared but no provider is configured yet.', extraction:rows[0]}); }
  const pending=(await client.query(`INSERT INTO contract_ai_extractions (contract_id,document_id,document_version_id,extraction_status,created_by,updated_at) VALUES ($1,$2,$3,'processing',$4,NOW()) RETURNING *`,base)).rows[0]; await recordContractLog(client,{contractId,action:'contract_ai_extraction_requested',actorId:req.user?.id||null,details:{extraction_id:pending.id}});
  const result=await runAiExtractionPlaceholder({contractId,documentId:pending.document_id,documentVersionId:pending.document_version_id});
  const completed=(await client.query(`UPDATE contract_ai_extractions SET extraction_status='completed',provider=$1,model=$2,extracted_parties=$3::jsonb,extracted_dates=$4::jsonb,extracted_value=$5::jsonb,extracted_payment_terms=$6::jsonb,extracted_renewal_clause=$7::jsonb,extracted_termination_clause=$8::jsonb,extracted_obligations=$9::jsonb,extracted_risks=$10::jsonb,summary=$11,confidence_score=$12,raw_json=$13::jsonb,updated_at=NOW() WHERE id=$14 RETURNING *`,[result.provider,result.model,JSON.stringify(result.extracted_parties||{}),JSON.stringify(result.extracted_dates||{}),JSON.stringify(result.extracted_value||{}),JSON.stringify(result.extracted_payment_terms||{}),JSON.stringify(result.extracted_renewal_clause||{}),JSON.stringify(result.extracted_termination_clause||{}),JSON.stringify(result.extracted_obligations||[]),JSON.stringify(result.extracted_risks||[]),result.summary||null,result.confidence_score,JSON.stringify(result.raw_json||{}),pending.id])).rows[0];
  await recordContractLog(client,{contractId,action:'contract_ai_extraction_completed',actorId:req.user?.id||null,details:{extraction_id:completed.id}}); await client.query('COMMIT'); res.status(201).json(completed);
 }catch(err){ if(client) await client.query('ROLLBACK').catch(()=>{}); try{ if(client){ await client.query(`INSERT INTO contract_ai_extractions (contract_id,document_id,document_version_id,extraction_status,error_message,created_by,updated_at) VALUES ($1,$2,$3,'failed',$4,$5,NOW())`,[Number(req.params.id)||null,req.body?.document_id||null,req.body?.document_version_id||null,err?.message||'Extraction failed',req.user?.id||null]); await recordContractLog(client,{contractId:Number(req.params.id)||null,action:'contract_ai_extraction_failed',actorId:req.user?.id||null,details:{error:err?.message||'Extraction failed'}}); } } catch(_){} next(createHttpError(500,'Failed to request AI extraction')); } finally { if(client) client.release(); }};
const listContractAiExtractions = async (req,res,next)=>{ try{ await ensureContractsPhaseSevenTables(); const {rows}=await pool.query('SELECT * FROM contract_ai_extractions WHERE contract_id=$1 ORDER BY created_at DESC',[Number(req.params.id)]); res.json(rows);}catch{next(createHttpError(500,'Failed'));}};
const getContractAiExtractionById = async (req,res,next)=>{ try{ await ensureContractsPhaseSevenTables(); const {rows}=await pool.query('SELECT * FROM contract_ai_extractions WHERE contract_id=$1 AND id=$2',[Number(req.params.id),Number(req.params.extractionId)]); if(!rows.length) return next(createHttpError(404,'Extraction not found')); res.json(rows[0]);}catch{next(createHttpError(500,'Failed'));}};

module.exports = {
  listContracts,
  getContractById,
  createContract,
  updateContract,
  archiveContract,
  unarchiveContract,
  renewContract,
  deleteContract,
  CONTRACT_STATUSES,
  getContractAttachments,
  uploadContractAttachment,
  deleteContractAttachment,
  getEvaluationCandidates,
  listContractAmendments,
  createContractAmendment,
  submitContractReview,
  listContractApprovals,
  decideContractApproval,
  listContractItems,
  createContractItem,
  updateContractItem,
  deleteContractItem,
  getDocumentChecklist,
  updateDocumentChecklist,
  getContractConsumption,
  getContractRisk,
  getContractRiskHistory,
  recalculateContractRisk,
  getContractRiskDashboard,
  listHighRiskContracts,
  requestContractAiExtraction,
  listContractAiExtractions,
  getContractAiExtractionById,
  listContractDocuments,
  createContractDocument,
  getContractDocument,
  updateContractDocument,
  addContractDocumentVersion,
  markContractDocumentVersionCurrent,
  archiveContractDocument,
  deleteContractDocument,
  listContractObligations,
  createContractObligation,
  getContractObligation,
  patchContractObligation,
  completeContractObligation,
  waiveContractObligation,
  cancelContractObligation,
  listDueSoonContractObligations,
  listContractRenewalEvents,
  createContractRenewalEvent,
  updateContractRenewalEvent,
  decideContractRenewalEvent,
  listDueSoonContractRenewals,
  listContractInvoices,
  createContractInvoice,
  getContractInvoice,
  updateContractInvoice,
  matchContractInvoice,
  updateContractInvoiceStatus,
  listContractPayments,
  createContractPayment,
  updateContractPayment,
  updateContractPaymentStatus,
  listContractConsumptionEntries,
  createContractConsumptionEntry,
  getContractFinancialSummary,
};