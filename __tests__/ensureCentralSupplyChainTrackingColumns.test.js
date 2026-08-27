jest.mock('../config/db', () => ({ query: jest.fn() }));

const fs = require('fs');
const path = require('path');
const ensureCentralSupplyChainTrackingColumns = require('../utils/ensureCentralSupplyChainTrackingColumns');

describe('ensureCentralSupplyChainTrackingColumns', () => {
  test('is SELECT-only and contains no runtime DDL', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { column_name: 'sent_to_central_supply_at', data_type: 'timestamp with time zone' },
      { column_name: 'sent_to_central_supply_by', data_type: 'integer' },
    ] }) };
    await ensureCentralSupplyChainTrackingColumns(client);
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/^SELECT/i);
    expect(sql).not.toMatch(/\b(?:ALTER|CREATE|DROP)\b/i);
  });

  test('fails missing columns as a controlled configuration error', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(ensureCentralSupplyChainTrackingColumns(client)).rejects.toMatchObject({
      code: 'CENTRAL_SUPPLY_SCHEMA_NOT_READY', statusCode: 503,
    });
  });

  test('production request/controller/service paths do not contain ALTER TABLE', () => {
    // Existing legacy runtime DDL is tracked as debt. The closed baseline makes any
    // new offender fail this test; Central Supply is intentionally not allowlisted.
    const legacyBaseline = new Set([
      'controllers/auditRegistryController.js', 'controllers/contractEvaluationsController.js',
      'controllers/contractGovernanceController.js', 'controllers/contractsController.js',
      'controllers/rfxPortalController.js', 'controllers/supplierEvaluationsController.js',
      'controllers/suppliersController.js', 'controllers/warehouseSupplyTemplatesController.js',
      'controllers/requests/assignRequestController.js', 'controllers/requests/createRequestController.js',
      'controllers/utils/approvalRouteVersioning.js', 'services/procurementEvaluationService.js',
      'utils/attachmentsColumnSupport.js', 'utils/ensureApprovalReminderColumn.js',
      'utils/ensureHistoricalRequestSchema.js', 'utils/ensureItemMasterTables.js',
      'utils/ensureItemRecallsTable.js', 'utils/ensureMaintenanceRequestSchema.js',
      'utils/ensureProcureToPayTables.js', 'utils/ensureProjectsTable.js',
      'utils/ensureRequestClientSubmissionKey.js', 'utils/ensureRequestSchedulingColumns.js',
      'utils/ensureRequestedItemApprovalColumns.js', 'utils/ensureRequestedItemFinancialsTable.js',
      'utils/ensureRequestedItemPoIssuanceColumn.js', 'utils/ensureRequestedItemReceivedColumns.js',
      'utils/ensureRequestedItemUnitOfMeasureColumn.js', 'utils/ensureRiskRegisterTable.js',
      'utils/ensureTechnicalInspectionsTable.js', 'utils/ensureWarehouseSupplyTables.js',
      'utils/evaluationCriteriaSeeder.js',
    ]);
    const roots = ['controllers', 'services', 'utils'];
    const files = roots.flatMap((root) => fs.readdirSync(path.join(__dirname, '..', root), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map((entry) => path.join(entry.parentPath, entry.name)));
    const backendRoot = path.join(__dirname, '..');
    const offenders = files.filter((file) => /\bALTER\s+TABLE\b/i.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(backendRoot, file).replaceAll(path.sep, '/'))
      .filter((file) => !legacyBaseline.has(file));
    expect(offenders).toEqual([]);
  });
});