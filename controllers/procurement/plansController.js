const path = require('path');
const fs = require('fs');
const pool = require('../../config/db');
const createHttpError = require('../../utils/httpError');
const {
  uploadBuffer,
  createSignedUrl,
} = require('../../utils/storage');
const {
  UPLOADS_DIR,
  isStoredLocally,
} = require('../../utils/attachmentPaths');
const sanitize = require('sanitize-filename');

const PLANS_STORAGE_PREFIX = process.env.SUPABASE_PLANS_PREFIX || 'procurement-plans';

function handleStorageError(next, err) {
  console.error('❌ Procurement plan storage error:', err.message);
  if (err.code === 'SUPABASE_NOT_CONFIGURED') {
    return next(
      createHttpError(
        500,
        'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      )
    );
  }
  return next(createHttpError(500, 'Failed to upload procurement plan'));
}

function serializePlan(row) {
  if (!row) return row;

  const storedPath = (row.file_path || '').replace(/\\/g, '/');
  const isLocal = isStoredLocally(storedPath);
  let fileUrl = null;

  if (isLocal && storedPath) {
    fileUrl = `/${storedPath}`;
  } else if (row.id) {
    fileUrl = `/api/procurement-plans/${row.id}/download`;
  }

  return {
    ...row,
    file_path: storedPath,
    download_url: fileUrl,
  };
}

const uploadPlan = async (req, res, next) => {
  const department_id =
    req.body.department_id && req.body.department_id !== 'null'
      ? parseInt(req.body.department_id, 10)
      : req.user.department_id;
  const plan_year = parseInt(req.body.plan_year, 10);

  if (Number.isNaN(plan_year) || !req.file) {
    return next(createHttpError(400, 'plan_year and file are required'));
  }

  if (Number.isNaN(department_id)) {
    return next(createHttpError(400, 'department_id must be a valid number'));
  }

  try {
    const segments = [`department-${department_id}`, `year-${plan_year}`];
    const { objectKey } = await uploadBuffer({
      file: req.file,
      segments,
      prefix: PLANS_STORAGE_PREFIX,
    });

    const { rows } = await pool.query(
      `INSERT INTO procurement_plans (department_id, plan_year, file_name, file_path)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [department_id, plan_year, req.file.originalname, objectKey]
    );

    res.status(201).json(serializePlan(rows[0]));
  } catch (err) {
    handleStorageError(next, err);
  }
};

const getPlans = async (req, res, next) => {
  const { department_id, year } = req.query;
  const values = [];
  let sql = 'SELECT * FROM procurement_plans WHERE 1=1';
  if (department_id) {
    values.push(department_id);
    sql += ` AND department_id = $${values.length}`;
  }
  if (year) {
    values.push(year);
    sql += ` AND plan_year = $${values.length}`;
  }
  sql += ' ORDER BY plan_year DESC';
  try {
    const result = await pool.query(sql, values);
    res.json(result.rows.map(serializePlan));
  } catch (err) {
    console.error('Failed to fetch procurement plans:', err);
    next(createHttpError(500, 'Failed to fetch procurement plans'));
  }
};

const getPlanById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM procurement_plans WHERE id=$1', [id]);
    if (result.rowCount === 0) return next(createHttpError(404, 'Plan not found'));
    res.json(serializePlan(result.rows[0]));
  } catch (err) {
    console.error('Failed to fetch procurement plan:', err);
    next(createHttpError(500, 'Failed to fetch procurement plan'));
  }
};

const getPlanForRequest = async (req, res, next) => {
  const { id } = req.params;
  try {
    const reqRes = await pool.query('SELECT department_id, created_at FROM requests WHERE id=$1', [id]);
    if (reqRes.rowCount === 0) return next(createHttpError(404, 'Request not found'));
    const { department_id, created_at } = reqRes.rows[0];
    const year = new Date(created_at).getFullYear();
    const planRes = await pool.query(
      'SELECT * FROM procurement_plans WHERE department_id=$1 AND plan_year=$2 LIMIT 1',
      [department_id, year]
    );
    if (planRes.rowCount === 0) return res.status(404).json({ message: 'No procurement plan found' });
    res.json(serializePlan(planRes.rows[0]));
  } catch (err) {
    console.error('Failed to match procurement plan:', err);
    next(createHttpError(500, 'Failed to match procurement plan'));
  }
};

const downloadPlan = async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM procurement_plans WHERE id=$1', [id]);
    if (result.rowCount === 0) {
      return next(createHttpError(404, 'Plan not found'));
    }

    const plan = result.rows[0];
    const storedPath = plan.file_path || '';

    if (!storedPath || isStoredLocally(storedPath)) {
      const filename = storedPath
        ? path.basename(storedPath)
        : sanitize(plan.file_name || 'plan');
      const filePath = path.join(UPLOADS_DIR, filename);

      return fs.access(filePath, fs.constants.F_OK, err => {
        if (err) {
          console.warn('🟥 Procurement plan missing on disk:', filePath);
          return next(createHttpError(404, 'Plan file not found'));
        }
        res.download(filePath, filename);
      });
    }

    const signedUrl = await createSignedUrl(storedPath, { expiresIn: 120 });
    return res.redirect(signedUrl);
  } catch (err) {
    console.error('Failed to download procurement plan:', err);
    if (err.code === 'SUPABASE_NOT_CONFIGURED') {
      return next(
        createHttpError(
          500,
          'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        )
      );
    }
    next(createHttpError(500, 'Failed to download procurement plan'));
  }
};

module.exports = { uploadPlan, getPlans, getPlanById, getPlanForRequest, downloadPlan };