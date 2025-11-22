const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');

// ✅ Admin / SCM – All incomplete requests
const getAllIncomplete = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission?.('requests.view-incomplete')) {
      return next(createHttpError(403, 'You do not have permission to view incomplete requests'));
    }

    const result = await pool.query(`
      SELECT DISTINCT r.*,
                      p.name AS project_name,
                      d.name AS department_name,
                      s.name AS section_name,
                      COALESCE(r.temporary_requester_name, u.name) AS requester_name
      FROM requests r
      JOIN users u ON r.requester_id = u.id
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN projects p ON r.project_id = p.id
      LEFT JOIN sections s ON r.section_id = s.id
      WHERE COALESCE(NULLIF(LOWER(TRIM(r.status)), ''), 'pending') NOT IN ('completed', 'received')
        AND EXISTS (
          SELECT 1 FROM public.requested_items ri
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

// ✅ CMO – Medical Requests approved by the CMO
const getMedicalIncomplete = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission?.('requests.view-incomplete')) {
      return next(createHttpError(403, 'You do not have permission to view medical incomplete requests'));
    }

    const result = await pool.query(`
      SELECT DISTINCT r.*,
                      p.name AS project_name,
                      d.name AS department_name,
                      s.name AS section_name,
                      COALESCE(r.temporary_requester_name, u.name) AS requester_name
      FROM requests r
      JOIN users u ON r.requester_id = u.id
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN projects p ON r.project_id = p.id
      LEFT JOIN sections s ON r.section_id = s.id
      WHERE r.request_domain = 'medical'
        AND COALESCE(NULLIF(LOWER(TRIM(r.status)), ''), 'pending') NOT IN ('completed', 'received')
        AND EXISTS (
          SELECT 1 FROM public.requested_items ri
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

// ✅ COO – All operational domain requests that are not completed/received
const getOperationalIncomplete = async (req, res, next) => {
  try {
    if (!req.user?.hasPermission?.('requests.view-incomplete')) {
      return next(createHttpError(403, 'You do not have permission to view operational incomplete requests'));
    }

    const result = await pool.query(
      `
      SELECT DISTINCT r.*,
                      p.name AS project_name,
                      d.name AS department_name,
                      s.name AS section_name,
                      COALESCE(r.temporary_requester_name, u.name) AS requester_name
      FROM requests r
      JOIN users u ON r.requester_id = u.id
      JOIN departments d ON r.department_id = d.id
      LEFT JOIN projects p ON r.project_id = p.id
      LEFT JOIN sections s ON r.section_id = s.id
      WHERE r.request_domain = 'operational'
        AND COALESCE(NULLIF(LOWER(TRIM(r.status)), ''), 'pending') NOT IN ('completed', 'received')
        AND EXISTS (
          SELECT 1 FROM public.requested_items ri
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