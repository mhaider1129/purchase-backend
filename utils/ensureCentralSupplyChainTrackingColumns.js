const pool = require('../config/db');

const REQUIRED_COLUMNS = new Map([
  ['sent_to_central_supply_at', 'timestamp with time zone'],
  ['sent_to_central_supply_by', 'integer'],
]);

const schemaNotReady = (details) => {
  const error = new Error(`CENTRAL_SUPPLY_SCHEMA_NOT_READY: ${details}`);
  error.code = 'CENTRAL_SUPPLY_SCHEMA_NOT_READY';
  error.statusCode = 503;
  return error;
};

/** Read-only guard for installations where manual migration 011 is pending. */
const ensureCentralSupplyChainTrackingColumns = async (client = pool) => {
  const result = await client.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'requests'
        AND column_name = ANY($1::text[])`,
    [[...REQUIRED_COLUMNS.keys()]],
  );

  const columns = new Map(result.rows.map(({ column_name, data_type }) => [column_name, data_type]));
  const problems = [...REQUIRED_COLUMNS].flatMap(([name, type]) => {
    if (!columns.has(name)) return [`missing public.requests.${name}`];
    if (columns.get(name) !== type) return [`public.requests.${name} is ${columns.get(name)}, expected ${type}`];
    return [];
  });
  if (problems.length) throw schemaNotReady(problems.join('; '));
};

module.exports = ensureCentralSupplyChainTrackingColumns;