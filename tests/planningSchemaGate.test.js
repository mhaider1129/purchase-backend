const requireSchema=require('../utils/ensureProcurementPlanTables');
test('missing planning tables fail closed without attempting schema mutations',async()=>{
 const db={query:jest.fn().mockResolvedValue({rows:[{planning_tables_available:false}]})};
 await expect(requireSchema(db)).rejects.toMatchObject({statusCode:503,code:'PLANNING_SCOPE_SCHEMA_REQUIRED'});
 expect(db.query).toHaveBeenCalledTimes(1);expect(db.query.mock.calls[0][0].trim().startsWith('SELECT')).toBe(true);
});
test('a failed preflight is not cached as installed',async()=>{
 const db={query:jest.fn().mockResolvedValueOnce({rows:[{planning_tables_available:false}]}).mockResolvedValueOnce({rows:[{planning_tables_available:true}]})};
 await expect(requireSchema(db)).rejects.toMatchObject({statusCode:503});await expect(requireSchema(db)).resolves.toBeUndefined();
});
