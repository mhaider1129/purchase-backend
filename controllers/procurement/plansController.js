const pool = require('../../config/db');
const path = require('path');
const createHttpError = require('../../utils/httpError');

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
    const { rows } = await pool.query(
      `INSERT INTO procurement_plans (department_id, plan_year, file_name, file_path)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [department_id, plan_year, req.file.originalname, req.file.path]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Failed to upload procurement plan:', err);
    next(createHttpError(500, 'Failed to upload procurement plan'));
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
    res.json(result.rows);
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
    res.json(result.rows[0]);
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
    res.json(planRes.rows[0]);
  } catch (err) {
    console.error('Failed to match procurement plan:', err);
    next(createHttpError(500, 'Failed to match procurement plan'));
  }
};

module.exports = { uploadPlan, getPlans, getPlanById, getPlanForRequest };