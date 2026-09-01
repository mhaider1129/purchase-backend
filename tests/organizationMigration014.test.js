const fs=require('fs');const path=require('path');
const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/014_organization_hierarchy.sql'),'utf8');
describe('manual migration 014 fail-closed contract',()=>{
 test('treats a compatible installation as a successful no-op',()=>{
  expect(sql).toContain("RAISE NOTICE 'SQL_014_ALREADY_APPLIED_COMPATIBLE'");
  expect(sql).not.toContain("RAISE EXCEPTION 'SQL_014_ALREADY_APPLIED_COMPATIBLE'");
  expect(sql).toContain("set_config('purchase_tracker.sql_014_install', 'false', true)");
  expect(sql).toContain("current_setting('purchase_tracker.sql_014_install') <> 'true'");
  expect(sql).toContain('SQL_014_PARTIAL_OR_DRIFTED_SCHEMA');
 });
 test('does not hide drift with permissive DDL',()=>{
  expect(sql).not.toMatch(/CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS/i);
  expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION|DROP\s+(?:TRIGGER|FUNCTION)\s+IF\s+EXISTS|duplicate_object/i);
 });
 test('checks critical column, constraint, and unique-index compatibility',()=>{
  for(const contract of ['information_schema.columns','data_type','is_nullable','organization_units_legacy_identity','organization_positions_dates','pg_get_constraintdef','pg_get_indexdef','indisunique']) expect(sql).toContain(contract);
 });
 test('validates canonical users.institute_id relationship',()=>{expect(sql).toMatch(/SELECT institute_id INTO user_institute FROM users WHERE id=NEW\.user_id/);expect(sql).toMatch(/position holder must belong to organization unit institute/)});
 test('repository schema declares users.institute_id as the institute foreign key',()=>{
  const schema=fs.readFileSync(path.join(__dirname,'../sql/View_Supabase_SQL.sql'),'utf8');
  const users=schema.match(/CREATE TABLE public\.users \([\s\S]*?\n\);/)?.[0];
  expect(users).toMatch(/institute_id integer/);
  expect(users).toMatch(/users_institute_id_fkey FOREIGN KEY \(institute_id\) REFERENCES public\.institutes\(id\)/);
 });
 test('bootstrap is guarded by preflight before inserts',()=>{expect(sql.indexOf('SQL_014_ALREADY_APPLIED_COMPATIBLE')).toBeLessThan(sql.indexOf('INSERT INTO organization_units'))});
});