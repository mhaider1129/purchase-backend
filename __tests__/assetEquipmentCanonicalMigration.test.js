const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/020_asset_equipment_canonical_identity.sql'), 'utf8');

test('020 preserves Asset authority when manufacturer or model is unknown', () => {
  expect(sql).toContain("ALTER COLUMN manufacturer DROP NOT NULL");
  expect(sql).toContain("ALTER COLUMN model DROP NOT NULL");
  expect(sql).toContain('SQL_020_DEPENDENCY_MISSING_OR_INCOMPATIBLE');
  expect(sql).not.toMatch(/IF NOT EXISTS|ADD COLUMN/);
});