const pool = require('../config/db');

const EVALUATION_CRITERIA = [
  {
    name: 'Contract Compliance',
    role: 'SCM',
    components: [
      'Adherence to contract terms and conditions',
      'Compliance with delivery schedules',
      'Accuracy of invoicing and payment processes',
    ],
  },
  {
    name: 'Supplier / Contractor Performance',
    role: 'END_USER',
    components: [
      'Quality of goods/services provided',
      'Responsiveness to issues and concerns',
      'Overall supplier relationship and communication',
    ],
  },
  {
    name: 'Financial Performance',
    role: 'SCM',
    components: [
      'Adherence to budget and pricing agreements',
      'Cost-effectiveness and value for money',
      'Financial stability of the supplier',
    ],
  },
  {
    name: 'Risk & Issue Management',
    role: 'CONTRACT_MANAGER',
    components: [
      'Proactive identification and mitigation of risks',
      'Effectiveness of issue resolution process',
      'Compliance with reporting requirements',
    ],
  },
  {
    name: 'Sustainability & Compliance',
    role: 'OHS',
    components: [
      'Adherence to health, safety, and environmental regulations',
      'Ethical and social responsibility practices',
      'Supplier diversity and inclusion initiatives',
    ],
  },
  {
    name: 'Stakeholder Satisfaction',
    role: 'END_USER',
    components: [
      'Satisfaction of end-users with goods/services',
      'Effective communication with stakeholders',
      'Responsiveness to stakeholder feedback',
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await pool.query('SELECT COUNT(*) FROM evaluation_criteria');
    if (rows[0].count === '0') {
      for (const criteria of EVALUATION_CRITERIA) {
        await pool.query(
          'INSERT INTO evaluation_criteria (name, role, components) VALUES ($1, $2, $3)',
          [criteria.name, criteria.role, JSON.stringify(criteria.components)]
        );
      }
    }
  } catch (err) {
    console.error('❌ Failed to ensure evaluation_criteria table exists:', err);
    throw err;
  }
};

module.exports = {
  ensureEvaluationCriteriaTable,
};