const defaultPool = require('../config/db');

async function withTransaction(work, options = {}) {
  if (typeof work !== 'function') throw new TypeError('withTransaction requires a callback');
  if (options.client) return work(options.client);
  const client = await (options.pool || defaultPool).connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = withTransaction;