const pool = require('../config/db');
let validationPromise;

/** Read-only compatibility validator. Schema changes belong in sql/manual. */
module.exports = async function validateRequesterSectionAssignments(client = pool) {
  if (process.env.NODE_ENV === 'test') return;
  if (validationPromise) return validationPromise;
  const runner = client.query ? client : pool;
  validationPromise = runner.query("SELECT to_regclass('public.user_section_assignments') AS relation")
    .then(({ rows }) => {
      if (!rows[0]?.relation) {
        const error = new Error('Requester section assignment schema is missing; review sql/manual/001_foundation_schema_requirements.sql');
        error.code = 'SCHEMA_VALIDATION_FAILED';
        throw error;
      }
    }).catch(error => { validationPromise = null; throw error; });
  return validationPromise;
};