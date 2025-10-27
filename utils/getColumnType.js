const pool = require('../config/db');

const cache = new Map();

const normalizeType = (row = {}) => {
  if (!row) return null;
  const { data_type: dataType, udt_name: udtName } = row;
  if (!dataType) return null;
  if (dataType === 'USER-DEFINED' && udtName) {
    return udtName;
  }
  return dataType;
};

const getColumnType = async (schema, table, column, runner = pool) => {
  const key = `${schema}.${table}.${column}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const executor = runner?.query ? runner : pool;
  const res = await executor.query(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1`,
    [schema, table, column],
  );

  if (res.rowCount === 0) {
    cache.set(key, null);
    return null;
  }

  const resolved = normalizeType(res.rows[0]);
  cache.set(key, resolved);
  return resolved;
};

module.exports = getColumnType;