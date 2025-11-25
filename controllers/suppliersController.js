
const pool = require('../config/db');
const createHttpError = require('../utils/httpError');

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

module.exports = {
  ensureSuppliersTable,
  listSuppliers,
  createSupplier,
  getSupplierById,
  findOrCreateSupplierByName,
};