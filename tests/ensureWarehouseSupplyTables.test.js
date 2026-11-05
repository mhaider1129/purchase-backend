jest.mock('../config/db', () => ({query:jest.fn()}));
test('ensureWarehouseSupplyApprovalColumns validates the manual contract without rewriting historical data', async () => {
 const client={query:jest.fn()};
 await require('../utils/ensureWarehouseSupplyTables').ensureWarehouseSupplyApprovalColumns(client);
 expect(require('../utils/runtimeSchemaContract').assertModuleContract).toHaveBeenCalledWith('utils/ensureWarehouseSupplyTables.js#ensureWarehouseSupplyApprovalColumns',client);
 expect(client.query).not.toHaveBeenCalled();
});
