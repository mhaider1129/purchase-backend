jest.mock('../config/db', () => ({query:jest.fn()}));
test('ensureHistoricalRequestSchema validates the manual contract without rewriting historical data', async () => {
 const client={query:jest.fn()};
 await require('../utils/ensureHistoricalRequestSchema')(client);
 expect(require('../utils/runtimeSchemaContract').assertModuleContract).toHaveBeenCalledWith('utils/ensureHistoricalRequestSchema.js#ensureHistoricalRequestSchema',client);
 expect(client.query).not.toHaveBeenCalled();
});
