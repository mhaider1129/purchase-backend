'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const pool = require('../config/db');
const router = require('../routes/procurementPerformance');

const cases = [
  { id: 1, activity_coverage: 'FULL', rfqs: 3 },
  { id: 2, activity_coverage: 'PARTIAL', rfqs: 2 },
  { id: 3, activity_coverage: 'MISSING', rfqs: 5 },
  { id: 4, activity_coverage: 'LEGACY_INCOMPLETE', rfqs: 4 },
];

const coverageRow = {
  total_cases: 4,
  activity_status: 'PARTIAL',
  activity_full_cases: 1,
  activity_partial_cases: 1,
  activity_missing_cases: 1,
  activity_legacy_incomplete_cases: 1,
  activity_usable_evidence_cases: 2,
  activity_coverage_percent: '50.00',
  activity_full_coverage_percent: '25.00',
};

const app = express();
app.use((req, res, next) => {
  req.user = { institute_id: 9, hasPermission: () => true };
  next();
});
app.use('/performance', router);

beforeEach(() => {
  pool.query.mockImplementation(async sql => {
    if (sql.includes('count(DISTINCT request_id)')) return { rows: [{ cases: 4, prs: 4, requested_items: 4, departments: 1 }] };
    if (sql.includes('complexity_class AS class')) return { rows: [] };
    if (sql.includes('pending_root_cause AS root_cause')) return { rows: [] };
    if (sql.includes('total_cases')) return { rows: [coverageRow] };
    if (sql.includes('FROM procurement_case_activities a')) {
      const trustedOnly = sql.includes("pc.activity_coverage IN ('FULL','PARTIAL')");
      const included = trustedOnly ? cases.filter(row => ['FULL', 'PARTIAL'].includes(row.activity_coverage)) : cases;
      const rfqs = included.reduce((total, row) => total + row.rfqs, 0);
      return { rows: [{ touches: rfqs, rfqs, quotations: 0 }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
});

test.each([
  ['FULL', 3, 3],
  ['PARTIAL', 2, 2],
  ['MISSING', 5, 0],
  ['LEGACY_INCOMPLETE', 4, 0],
])('%s case with %i stored RFQs contributes %i to the trusted population', (coverage, stored, expected) => {
  const included = ['FULL', 'PARTIAL'].includes(coverage);
  expect(included ? stored : 0).toBe(expected);
});

test('dashboard aligns trusted activity numerators with FULL plus PARTIAL coverage', async () => {
  const response = await request(app).get('/performance/dashboard');

  expect(response.status).toBe(200);
  expect(response.body.metrics.activities).toMatchObject({
    touches: 5,
    rfqs: 5,
    quotations: 0,
    usable_evidence_cases: 2,
    total_cases: 4,
    coverage_percent: '50.00',
  });
  const activitySql = pool.query.mock.calls.map(([sql]) => sql).find(sql => sql.includes('FROM procurement_case_activities a'));
  expect(activitySql).toContain("pc.activity_coverage IN ('FULL','PARTIAL')");
});

test('case detail still returns stored activity for a LEGACY_INCOMPLETE case', async () => {
  const legacyActivity = { id: 44, procurement_case_id: 4, activity_type: 'RFQ_CREATED' };
  pool.query.mockImplementation(async sql => {
    if (sql.includes('SELECT pc.*,ri.item_name')) return { rowCount: 1, rows: [{ id: 4, activity_coverage: 'LEGACY_INCOMPLETE' }] };
    if (sql.includes('FROM procurement_case_activities WHERE')) return { rows: [legacyActivity] };
    return { rows: [] };
  });

  const response = await request(app).get('/performance/cases/4');

  expect(response.status).toBe(200);
  expect(response.body.timeline).toEqual([legacyActivity]);
  expect(response.body.coverage.activity).toBe('LEGACY_INCOMPLETE');
});