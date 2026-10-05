const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/019_asset_equipment_integration.sql'), 'utf8');

test('019 installs a tenant-safe optional one-to-one Asset link', () => {
  expect(sql).toContain('FOREIGN KEY (institute_id,asset_id)');
  expect(sql).toContain('REFERENCES public.assets(institute_id,id)');
  expect(sql).toMatch(/CREATE UNIQUE INDEX maintainable_equipment_asset_uq[\s\S]*WHERE asset_id IS NOT NULL/);
  expect(sql).toContain('SQL_019_PARTIAL_OR_DRIFTED_SCHEMA');
  expect(sql).not.toMatch(/CREATE (?:TABLE|INDEX) IF NOT EXISTS/);
});

test('019 introduces first-class equipment permissions and migrates existing role access', () => {
  for (const permission of ['equipment.view', 'equipment.manage', 'spare-parts.view', 'spare-parts.manage-compatibility']) expect(sql).toContain(permission);
  expect(sql).toMatch(/INSERT INTO public\.role_permissions\(role_id,permission_id\)[^;]*target\.code='equipment\.view'[^;]*source\.code='spare-parts\.view'/);
  expect(sql).toMatch(/INSERT INTO public\.role_permissions\(role_id,permission_id\)[^;]*target\.code='equipment\.manage'[^;]*source\.code='spare-parts\.manage-compatibility'/);
});
