'use strict';

// This is the canonical, transaction-bound neutral profile provisioner. It is
// intentionally limited to coverage: assessment and ranking facts must only be
// supplied by their respective workflows.
async function provisionNeutralPriorityProfile({ client, procurementCaseId, instituteId, departmentId }) {
  const result = await client.query(
    `INSERT INTO procurement_priority_profiles(procurement_case_id,institute_id,department_id,coverage_status)
     VALUES($1,$2,$3,'NEEDS_ASSESSMENT')
     ON CONFLICT(procurement_case_id) DO UPDATE
       SET procurement_case_id=EXCLUDED.procurement_case_id
     RETURNING *`,
    [procurementCaseId, instituteId, departmentId],
  );
  return result.rows[0];
}

module.exports = { provisionNeutralPriorityProfile };