
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');
const { ensureSupplierEvaluationsTable } = require('./supplierEvaluationsController');

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

let suppliersEnsured = false;
let ensuringPromise = null;

const ensureSuppliersTable = async () => {
  if (suppliersEnsured) {
    return;
  }

  if (!ensuringPromise) {
    ensuringPromise = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS suppliers (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            contact_email TEXT,
            contact_phone TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_ci_idx
            ON suppliers (LOWER(name))
        `);

        suppliersEnsured = true;
      } finally {
        ensuringPromise = null;
      }
    })();
  }

  await ensuringPromise;
};

const getSupplierById = async (client, supplierId) => {
  const parsedId = Number(supplierId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return null;
  }

  await ensureSuppliersTable();
  const executor = client || pool;
  const { rows } = await executor.query(
    `SELECT id, name, contact_email, contact_phone, created_at, updated_at
       FROM suppliers
      WHERE id = $1
      LIMIT 1`,
    [parsedId]
  );

  return rows[0] || null;
};

const findOrCreateSupplierByName = async (client, name) => {
  const sanitizedName = normalizeText(name);
  if (!sanitizedName) {
    throw createHttpError(400, 'supplier name is required');
  }

  await ensureSuppliersTable();
  const executor = client || pool;

  const existing = await executor.query(
    `SELECT id, name, contact_email, contact_phone, created_at, updated_at
       FROM suppliers
      WHERE LOWER(name) = LOWER($1)
      LIMIT 1`,
    [sanitizedName]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  try {
    const inserted = await executor.query(
      `INSERT INTO suppliers (name)
         VALUES ($1)
         RETURNING id, name, contact_email, contact_phone, created_at, updated_at`,
      [sanitizedName]
    );

    return inserted.rows[0];
  } catch (err) {
    if (err?.code === '23505') {
      const retry = await executor.query(
        `SELECT id, name, contact_email, contact_phone, created_at, updated_at
           FROM suppliers
          WHERE LOWER(name) = LOWER($1)
          LIMIT 1`,
        [sanitizedName]
      );

      if (retry.rowCount > 0) {
        return retry.rows[0];
      }
    }

    throw err;
  }
};

const listSuppliers = async (req, res, next) => {
  try {
    await ensureSuppliersTable();
    const { rows } = await pool.query(
      `SELECT id, name, contact_email, contact_phone, created_at, updated_at
         FROM suppliers
        ORDER BY LOWER(name) ASC`
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Failed to list suppliers:', err);
    next(createHttpError(500, 'Failed to load suppliers'));
  }
};

const createSupplier = async (req, res, next) => {
  const canManageSuppliers =
    req.user?.hasPermission && req.user.hasPermission('contracts.manage');

  if (!canManageSuppliers) {
    return next(createHttpError(403, 'You are not authorized to create suppliers'));
  }

  const name = normalizeText(req.body?.name);
  const contactEmail = normalizeText(req.body?.contact_email) || null;
  const contactPhone = normalizeText(req.body?.contact_phone) || null;

  if (!name) {
    return next(createHttpError(400, 'Supplier name is required'));
  }

  try {
    const supplier = await findOrCreateSupplierByName(pool, name);

    if (contactEmail || contactPhone) {
      const updated = await pool.query(
        `UPDATE suppliers
            SET contact_email = COALESCE($1, contact_email),
                contact_phone = COALESCE($2, contact_phone),
                updated_at = NOW()
          WHERE id = $3
        RETURNING id, name, contact_email, contact_phone, created_at, updated_at`,
        [contactEmail, contactPhone, supplier.id]
      );

      return res.status(201).json(updated.rows[0]);
    }

    res.status(201).json(supplier);
  } catch (err) {
    console.error('❌ Failed to create supplier:', err);
    next(createHttpError(500, 'Failed to create supplier'));
  }
};

const updateSupplier = async (req, res, next) => {
  const canManageSuppliers =
    req.user?.hasPermission && req.user.hasPermission('contracts.manage');

  if (!canManageSuppliers) {
    return next(createHttpError(403, 'You are not authorized to update suppliers'));
  }

  const supplierId = Number(req.params.id);

  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureSuppliersTable();
    const existing = await getSupplierById(pool, supplierId);

    if (!existing) {
      return next(createHttpError(404, 'Supplier not found'));
    }

    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const newName = normalizeText(req.body.name);

      if (!newName) {
        return next(createHttpError(400, 'Supplier name is required'));
      }

      updates.push(`name = $${updates.length + 1}`);
      values.push(newName);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'contact_email')) {
      updates.push(`contact_email = $${updates.length + 1}`);
      values.push(normalizeText(req.body.contact_email) || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'contact_phone')) {
      updates.push(`contact_phone = $${updates.length + 1}`);
      values.push(normalizeText(req.body.contact_phone) || null);
    }

    if (updates.length === 0) {
      return res.json(existing);
    }

    updates.push(`updated_at = NOW()`);
    values.push(supplierId);

    const query = `UPDATE suppliers
                      SET ${updates.join(', ')}
                    WHERE id = $${values.length}
                RETURNING id, name, contact_email, contact_phone, created_at, updated_at`;

    const { rows } = await pool.query(query, values);

    return res.json(rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return next(createHttpError(400, 'A supplier with this name already exists'));
    }

    console.error('❌ Failed to update supplier:', err);
    next(createHttpError(500, 'Failed to update supplier'));
  }
};

const deleteSupplier = async (req, res, next) => {
  const canManageSuppliers =
    req.user?.hasPermission && req.user.hasPermission('contracts.manage');

  if (!canManageSuppliers) {
    return next(createHttpError(403, 'You are not authorized to delete suppliers'));
  }

  const supplierId = Number(req.params.id);

  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return next(createHttpError(400, 'Invalid supplier id'));
  }

  try {
    await ensureSuppliersTable();
    const existing = await getSupplierById(pool, supplierId);

    if (!existing) {
      return next(createHttpError(404, 'Supplier not found'));
    }

    await pool.query('DELETE FROM suppliers WHERE id = $1', [supplierId]);

    return res.status(204).send();
  } catch (err) {
    if (err?.code === '23503') {
      return next(
        createHttpError(409, 'Supplier is linked to other records and cannot be deleted')
      );
    }

    console.error('❌ Failed to delete supplier:', err);
    next(createHttpError(500, 'Failed to delete supplier'));
  }
};

const getSuppliersDashboard = async (req, res, next) => {
  try {
    await ensureSuppliersTable();
    await ensureSupplierEvaluationsTable();

    const [summaryResult, coverageResult, recentResult] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS total_suppliers,
               SUM(CASE WHEN contact_email IS NOT NULL AND contact_email <> '' THEN 1 ELSE 0 END) AS with_email,
               SUM(CASE WHEN contact_phone IS NOT NULL AND contact_phone <> '' THEN 1 ELSE 0 END) AS with_phone,
               SUM(CASE
                     WHEN (contact_email IS NOT NULL AND contact_email <> '')
                          OR (contact_phone IS NOT NULL AND contact_phone <> '')
                     THEN 1 ELSE 0 END) AS with_contact
          FROM suppliers
      `),
      pool.query(`
        SELECT s.id,
               s.name,
               s.contact_email,
               s.contact_phone,
               MAX(se.evaluation_date) AS last_evaluation_date,
               COUNT(se.id) AS evaluation_count
          FROM suppliers s
     LEFT JOIN supplier_evaluations se ON LOWER(se.supplier_name) = LOWER(s.name)
      GROUP BY s.id, s.name, s.contact_email, s.contact_phone
      ORDER BY last_evaluation_date DESC NULLS LAST, s.name ASC
         LIMIT 12
      `),
      pool.query(`
        SELECT id, name, contact_email, contact_phone, created_at
          FROM suppliers
      ORDER BY created_at DESC
         LIMIT 8
      `),
    ]);

    const summary = summaryResult.rows[0] || {};
    const totalSuppliers = Number(summary.total_suppliers) || 0;
    const withContact = Number(summary.with_contact) || 0;

    res.json({
      totals: {
        suppliers: totalSuppliers,
        with_email: Number(summary.with_email) || 0,
        with_phone: Number(summary.with_phone) || 0,
        with_contact: withContact,
        without_contact: Math.max(totalSuppliers - withContact, 0),
      },
      coverage: coverageResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        contact_email: row.contact_email,
        contact_phone: row.contact_phone,
        last_evaluation_date: row.last_evaluation_date,
        evaluation_count: Number(row.evaluation_count) || 0,
      })),
      recent_suppliers: recentResult.rows,
    });
  } catch (err) {
    console.error('❌ Failed to load suppliers dashboard:', err);
    if (err.statusCode) {
      return next(err);
    }
    next(createHttpError(500, 'Failed to load suppliers dashboard'));
  }
};

module.exports = {
  ensureSuppliersTable,
  listSuppliers,
  createSupplier,
  getSupplierById,
  findOrCreateSupplierByName,
  getSuppliersDashboard,
  updateSupplier,
  deleteSupplier,
};