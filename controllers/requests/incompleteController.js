const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

// ✅ Admin / SCM – All incomplete requests
const getAllIncomplete = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT r.*, 
                      d.name AS department_name, 
                      s.name AS section_name,
                      u.name AS requester_name
      FROM requests r
      JOIN users u ON r.requester_id = u.id
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN sections s ON r.section_id = s.id
      WHERE r.status = 'Approved'
        AND EXISTS (
          SELECT 1 FROM requested_items ri
          WHERE ri.request_id = r.id
            AND (ri.procurement_status IS NULL OR ri.procurement_status NOT IN ('purchased', 'completed'))
        )
      ORDER BY r.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('❌ [Admin/SCM] getAllIncomplete:', err);
    next(createHttpError(500, 'Failed to fetch all incomplete requests'));
  }
};

// ✅ CMO – Medical Requests
const getMedicalIncomplete = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT r.*, 
                      d.name AS department_name, 
                      s.name AS section_name,
                      u.name AS requester_name
      FROM requests r
      JOIN users u ON r.requester_id = u.id
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN sections s ON r.section_id = s.id
      WHERE r.status = 'Approved'
        AND r.request_domain = 'medical'
        AND EXISTS (
          SELECT 1 FROM requested_items ri
          WHERE ri.request_id = r.id
            AND (ri.procurement_status IS NULL OR ri.procurement_status NOT IN ('purchased', 'completed'))
        )
      ORDER BY r.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('❌ [CMO] getMedicalIncomplete:', err);
    next(createHttpError(500, 'Failed to fetch medical incomplete requests'));
  }
};

// ✅ COO – Operational Requests
const getOperationalIncomplete = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT r.*, 
                      d.name AS department_name, 
                      s.name AS section_name,
                      u.name AS requester_name
      FROM requests r
      JOIN users u ON r.requester_id = u.id
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN sections s ON r.section_id = s.id
      WHERE r.status = 'Approved'
        AND r.request_domain = 'operational'
        AND EXISTS (
          SELECT 1 FROM requested_items ri
          WHERE ri.request_id = r.id
            AND (ri.procurement_status IS NULL OR ri.procurement_status NOT IN ('purchased', 'completed'))
        )
      ORDER BY r.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('❌ [COO] getOperationalIncomplete:', err);
    next(createHttpError(500, 'Failed to fetch operational incomplete requests'));
  }
};

module.exports = {
  getAllIncomplete,
  getMedicalIncomplete,
  getOperationalIncomplete,
};
