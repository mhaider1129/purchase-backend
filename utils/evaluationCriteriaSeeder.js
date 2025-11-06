const pool = require('../config/db');

const EVALUATION_CRITERIA = [
  {
    code: 'contract_compliance',
    name: 'Contract Compliance',
    role: 'SCM',
    components: [
      'Adherence to contractual terms and deliverables',
      'Compliance with agreed delivery or milestone schedules',
      'Accuracy and completeness of required documentation',
      'Effectiveness of variation and change-order control',
    ],
  },
  {
    code: 'supplier_contractor_performance',
    name: 'Supplier / Contractor Performance',
    role: 'HOD',
    components: [
      'Quality of goods and services delivered',
      'Responsiveness to issues, escalations, and queries',
      'Technical competency and adherence to specifications',
      'Collaboration with end user and technical departments',
    ],
  },
  {
    code: 'financial_performance',
    name: 'Financial Performance',
    role: 'SCM',
    components: [
      'Adherence to budget, unit rates, and pricing agreements',
      'Proactive cost control and savings opportunities',
      'Accuracy and timeliness of invoices and supporting documents',
    ],
  },
  {
    code: 'risk_issue_management',
    name: 'Risk & Issue Management',
    role: 'CONTRACT_MANAGER',
    components: [
      'Early identification and mitigation of emerging risks',
      'Effectiveness of escalation and issue resolution actions',
      'Compliance with governance and reporting requirements',
    ],
  },
  {
    code: 'sustainability_compliance',
    name: 'Sustainability & Compliance',
    role: 'OHS',
    components: [
      'Compliance with health, safety, and environmental standards',
      'Implementation of sustainable and responsible practices',
      'Alignment with legal, regulatory, and audit requirements',
    ],
  },
  {
    code: 'stakeholder_satisfaction',
    name: 'Stakeholder Satisfaction',
    role: 'HOD',
    components: [
      'Feedback from end users on service outcomes',
      'Transparency and effectiveness of communication',
      'Support for continuous improvement and lessons learned',
    ],
  },
];

const ensureEvaluationCriteriaTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS evaluation_criteria (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        components JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        code TEXT
      )
    `);

    await pool.query(`
      ALTER TABLE evaluation_criteria
        ADD COLUMN IF NOT EXISTS code TEXT,
        ADD COLUMN IF NOT EXISTS assignment_config JSONB
    `);

    await pool.query(`
      UPDATE evaluation_criteria
         SET code = LOWER(code)
       WHERE code IS NOT NULL AND code <> LOWER(code)
    `);

    await pool.query(`
      DROP INDEX IF EXISTS evaluation_criteria_code_idx
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS evaluation_criteria_code_unique_idx
        ON evaluation_criteria(code)
    `);

    for (const criteria of EVALUATION_CRITERIA) {
      const normalizedCode = criteria.code ? criteria.code.toLowerCase() : null;
      const componentsJson = JSON.stringify(criteria.components);

      await pool.query(
        `WITH target AS (
            SELECT id
              FROM evaluation_criteria
             WHERE code IS NULL AND LOWER(name) = LOWER($2)
             ORDER BY id
             LIMIT 1
          )
          UPDATE evaluation_criteria ec
             SET code = $1,
                 name = $2,
                 role = $3,
                 components = $4
            FROM target
           WHERE ec.id = target.id`,
        [normalizedCode, criteria.name, criteria.role, componentsJson]
      );

      await pool.query(
        `INSERT INTO evaluation_criteria (code, name, role, components)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name,
               role = EXCLUDED.role,
               components = EXCLUDED.components`,
        [normalizedCode, criteria.name, criteria.role, componentsJson]
      );
    }

    await pool.query(
      `DELETE FROM evaluation_criteria
        WHERE code IS NULL
          AND LOWER(name) = ANY($1::text[])`,
      [EVALUATION_CRITERIA.map((criteria) => criteria.name.toLowerCase())]
    );
  } catch (err) {
    console.error('❌ Failed to ensure evaluation_criteria table exists:', err);
    throw err;
  }
};

module.exports = {
  ensureEvaluationCriteriaTable,
};