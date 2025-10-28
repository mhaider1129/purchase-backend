const pool = require('../config/db');

const cache = new Map();

/**
 * Checks whether a column exists on the given table.
 * Results are cached per-process to avoid repeating the lookup.
 *
 * @param {Object} options
 * @param {string} options.table - Table name (required).
 * @param {string} options.column - Column name (required).
 * @param {string} [options.schema='public'] - Schema name.
 * @param {Object} [options.runner=pool] - Optional client/pool with a query method.
 * @returns {Promise<boolean>} Whether the column exists.
 */
const checkColumnExists = async ({ table, column, schema = 'public', runner } = {}) => {
  if (!table || !column) {
    throw new Error('Both table and column are required to check column existence');
  }

  const key = `${schema}.${table}.${column}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const executor = runner && typeof runner.query === 'function' ? runner : pool;
  const result = await executor.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1`,
    [schema, table, column]
  );

  const exists = result.rowCount > 0;
  cache.set(key, exists);
  return exists;
};

checkColumnExists.clearCache = () => cache.clear();

module.exports = checkColumnExists;