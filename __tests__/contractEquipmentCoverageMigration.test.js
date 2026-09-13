const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/021_contract_equipment_coverage.sql'), 'utf8');

test('021 defines governed effective-dated Equipment coverage', () => {
  for (const marker of ['contract_equipment_coverage', 'coverage_start', 'coverage_end', 'pm_included', 'corrective_included', 'parts_included', 'uptime_target_percent']) expect(sql).toContain(marker);
  expect(sql).toContain('coverage_end >= coverage_start');
  expect(sql).toContain('uptime_target_percent BETWEEN 0 AND 100');
  expect(sql).toContain('institute_id integer NOT NULL REFERENCES public.institutes');
  expect(sql).toContain('FOREIGN KEY (institute_id,equipment_id)');
  expect(sql).toContain('SQL_021_ALREADY_APPLIED_COMPATIBLE');
  expect(sql).toContain('SQL_021_PARTIAL_OR_DRIFTED_SCHEMA');
  expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS/);
});