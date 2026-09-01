const fs=require('fs');const path=require('path');
const sql=fs.readFileSync(path.join(__dirname,'../sql/manual/013_approved_spare_parts_foundation.sql'),'utf8');
test('migration is manual, fail-closed, numeric, scoped, and contains no runtime DDL hook',()=>{expect(sql).toMatch(/PENDING MANUAL MIGRATION 013/);expect(sql).toMatch(/SQL_013_ALREADY_OR_PARTIALLY_INSTALLED/);expect(sql).toMatch(/recommended_min_quantity NUMERIC/);expect(sql).toMatch(/lower\(btrim\(spare_part_code\)\)/);expect(sql).toMatch(/spare_part_equipment_active_uq/);expect(sql).not.toMatch(/supplier_(price|ranking)|spare_part_sourcing_options/i);});
test.each(['approved_spare_parts','maintainable_equipment','spare_part_equipment_compatibility','spare-parts.technical-approve','spare-parts.manage-stock-policy'])(`contains governed foundation %s`,value=>expect(sql).toContain(value));
test('indexes authoritative register ordering, filters, and relationship access paths',()=>{
  expect(sql).toMatch(/approved_spare_parts_institute_updated_idx ON approved_spare_parts\(institute_id, updated_at DESC, id DESC\)/);
  expect(sql).toMatch(/approved_spare_parts_institute_stocking_idx ON approved_spare_parts\(institute_id, recommended_stocking_policy\)/);
  expect(sql).toMatch(/maintainable_equipment_institute_name_idx ON maintainable_equipment\(institute_id, name\)/);
  expect(sql).toMatch(/maintainable_equipment_institute_department_lifecycle_idx ON maintainable_equipment\(institute_id, department_id, lifecycle_status\)/);
  expect(sql).toMatch(/spare_part_equipment_equipment_active_idx ON spare_part_equipment_compatibility\(equipment_id, spare_part_id\) WHERE compatibility_status <> 'INACTIVE'/);
});
test('documents that leading-wildcard ILIKE search is not falsely served by B-tree indexes',()=>{
  expect(sql).toMatch(/Leading-wildcard ILIKE search intentionally has no B-tree index/);
  expect(sql).not.toMatch(/CREATE EXTENSION[^;]*pg_trgm/i);
});