'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const defaults = require('../services/itemMasterReferenceDefaults');

// Called only by the guarded runner-created disposable PostgreSQL harness.
module.exports = async function validateItemReferenceStarterData(client) {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/manual/044_item_master_reference_starter_data.sql'), 'utf8');
  // Local fixture variants: missing normalization, case/spacing, inactive and
  // a conflicting UOM name under a different code. Preserve every field.
  await client.query("INSERT INTO item_categories(category_name,is_active) VALUES ('  furniture  ',FALSE)");
  await client.query("INSERT INTO item_uom(uom_code,uom_name,is_active) VALUES ('box','Box',FALSE),('LEGACY-EA','Each',TRUE)");
  const snapshot = async (table) => (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  const categoriesBefore = await snapshot('item_categories');
  const uomBefore = await snapshot('item_uom');
  const auditBefore = await snapshot('item_master_audit_events');
  await client.query(sql);
  const categories = await snapshot('item_categories');
  const uom = await snapshot('item_uom');
  const audits = await snapshot('item_master_audit_events');
  for (const [before, after] of [[categoriesBefore, categories], [uomBefore, uom], [auditBefore, audits]]) {
    for (const row of before) assert.deepEqual(after.find(r => r.id === row.id), row);
  }
  for (const name of defaults.categories) {
    assert(categories.some(r => r.category_name.trim().toLowerCase() === name.toLowerCase()));
  }
  for (const [code, name] of defaults.uom) {
    assert(uom.some(r => r.uom_code.toUpperCase() === code || r.uom_name.toLowerCase() === name.toLowerCase()));
  }
  const addedCount = categories.length - categoriesBefore.length + uom.length - uomBefore.length;
  assert(addedCount > 0);
  assert.equal(audits.length - auditBefore.length, addedCount);
  for (const event of audits.slice(auditBefore.length)) {
    assert.equal(event.action, 'REFERENCE_CREATED');
    assert.equal(event.actor_id, null);
    assert.match(event.reason, /Manual SQL 044/);
    assert.equal(String(event.new_values.id), String(event.entity_id));
  }
  assert.equal(categories.filter(r => r.category_name.trim().toLowerCase() === 'furniture').length, 1);
  assert.equal(uom.filter(r => r.uom_code.toUpperCase() === 'BOX').length, 1);
  assert.equal(uom.filter(r => r.uom_name.toLowerCase() === 'each').length, 1);
  await client.query(sql);
  assert.deepEqual(await snapshot('item_categories'), categories);
  assert.deepEqual(await snapshot('item_uom'), uom);
  assert.deepEqual(await snapshot('item_master_audit_events'), audits);
  console.log('SQL 044 starter reference data: defaults, preservation, inactive/name conflicts, audits and idempotency PASS');
};
