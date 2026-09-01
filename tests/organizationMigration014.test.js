const fs=require('fs');const path=require('path');
const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/014_organization_hierarchy.sql'),'utf8');
describe('manual migration 014 fail-closed contract',()=>{
 test('has deterministic compatible and drift markers',()=>{expect(sql).toContain('SQL_014_ALREADY_APPLIED_COMPATIBLE');expect(sql).toContain('SQL_014_PARTIAL_OR_DRIFTED_SCHEMA')});
 test('does not hide drift with IF NOT EXISTS',()=>{expect(sql).not.toMatch(/CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/i)});
 test('validates canonical users.institute_id relationship',()=>{expect(sql).toMatch(/SELECT institute_id INTO user_institute FROM users WHERE id=NEW\.user_id/);expect(sql).toMatch(/position holder must belong to organization unit institute/)});
 test('bootstrap is guarded by preflight before inserts',()=>{expect(sql.indexOf('SQL_014_ALREADY_APPLIED_COMPATIBLE')).toBeLessThan(sql.indexOf('INSERT INTO organization_units'))});
});