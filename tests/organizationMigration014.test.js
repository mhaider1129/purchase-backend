const fs=require('fs');const path=require('path');
const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/014_organization_hierarchy.sql'),'utf8');
describe('manual migration 014 fail-closed contract',()=>{
 test('treats a compatible installation as a successful rerun',()=>{
  expect(sql).toContain("RAISE NOTICE 'SQL_014_ALREADY_APPLIED_COMPATIBLE'");
  expect(sql).not.toContain("RAISE EXCEPTION 'SQL_014_ALREADY_APPLIED_COMPATIBLE'");
  expect(sql).toContain('SQL_014_PARTIAL_OR_DRIFTED_SCHEMA');
 });
 test('keeps creation statements convergent after preflight',()=>{
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS organization_units/i);
  expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS organization_units_parent_idx/i);
  expect(sql).toMatch(/ON CONFLICT \(department_id\) DO NOTHING/i);
 });
 test('validates canonical users.institute_id relationship',()=>{expect(sql).toMatch(/SELECT institute_id INTO user_institute FROM users WHERE id=NEW\.user_id/);expect(sql).toMatch(/position holder must belong to organization unit institute/)});
 test('bootstrap is guarded by preflight before inserts',()=>{expect(sql.indexOf('SQL_014_ALREADY_APPLIED_COMPATIBLE')).toBeLessThan(sql.indexOf('INSERT INTO organization_units'))});
});