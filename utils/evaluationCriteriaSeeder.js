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
  // AUD-010: schema is owned by the reviewed manual release, not this request.
  return require("./runtimeSchemaContract").assertModuleContract("utils/evaluationCriteriaSeeder.js#ensureEvaluationCriteriaTable", pool);
};

module.exports = {
  ensureEvaluationCriteriaTable,
};