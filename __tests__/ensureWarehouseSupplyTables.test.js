jest.mock('../config/db', () => ({query:jest.fn()}));
test('ensureWarehouseSupplyTables validates the manual contract without rewriting historical data', async () => {
 const client={query:jest.fn()};
 await require('../utils/ensureWarehouseSupplyTables').ensureWarehouseSupplyTables(client);
 expect(require('../utils/runtimeSchemaContract').assertModuleContract).toHaveBeenCalledWith('utils/ensureWarehouseSupplyTables.js#ensureWarehouseSupplyTables',client);
 expect(client.query).not.toHaveBeenCalled();
});
