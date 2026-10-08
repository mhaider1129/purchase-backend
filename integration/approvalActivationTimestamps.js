const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Invoked exclusively by the guarded disposable PostgreSQL harness.
module.exports = async (client) => {
  const patch = fs.readFileSync(path.join(__dirname, '../sql/manual/045_approval_activation_timestamps.sql'), 'utf8');
  const insert = async (active, superseded = false) => (await client.query(
    "INSERT INTO public.approvals (status, is_active, is_superseded, approval_level) VALUES ('Pending', $1, $2, 1) RETURNING *", [active, superseded],
  )).rows[0];
  const historical = await insert(true);
  await client.query(patch);
  const get = async (id) => (await client.query('SELECT * FROM public.approvals WHERE id = $1', [id])).rows[0];
  const historyAfter = await get(historical.id);
  assert.equal(historyAfter.activated_at, null);
  delete historyAfter.activated_at;
  assert.deepEqual(historyAfter, historical, 'Existing business data must be preserved');
  const inactive = await insert(false);
  assert.equal(inactive.activated_at, null);
  const active = await insert(true);
  assert(active.activated_at instanceof Date);
  const apiTimestamp = (await client.query("SELECT to_jsonb(ap)->>'activated_at' AS activated_at FROM public.approvals ap WHERE id = $1", [active.id])).rows[0].activated_at;
  assert.equal(Date.parse(apiTimestamp), active.activated_at.getTime());
  assert.equal((await insert(true, true)).activated_at, null);
  await client.query('UPDATE public.approvals SET is_active = true WHERE id = $1', [inactive.id]);
  const activated = await get(inactive.id);
  assert(activated.activated_at instanceof Date);
  await client.query("UPDATE public.approvals SET is_active = true, activated_at = '2000-01-01', comments = 'ordinary edit' WHERE id = $1", [inactive.id]);
  assert.deepEqual((await get(inactive.id)).activated_at, activated.activated_at);
  await client.query('SELECT pg_sleep(0.01)');
  await client.query('UPDATE public.approvals SET approval_level = 2 WHERE id = $1', [inactive.id]);
  const reassigned = await get(inactive.id);
  assert(reassigned.activated_at > activated.activated_at);
  await client.query("UPDATE public.approvals SET status = 'Approved', is_active = false WHERE id = $1", [inactive.id]);
  assert.deepEqual((await get(inactive.id)).activated_at, reassigned.activated_at);
  await client.query('SELECT pg_sleep(0.01)');
  await client.query("UPDATE public.approvals SET status = 'Pending', is_active = true WHERE id = $1", [inactive.id]);
  assert((await get(inactive.id)).activated_at > reassigned.activated_at);
  const beforeRepeat = await get(inactive.id);
  await client.query('UPDATE public.approvals SET is_superseded = true WHERE id = $1', [inactive.id]);
  await client.query('SELECT pg_sleep(0.01)');
  await client.query('UPDATE public.approvals SET is_superseded = false WHERE id = $1', [inactive.id]);
  assert((await get(inactive.id)).activated_at > beforeRepeat.activated_at);
  const beforeReapply = await get(inactive.id);
  await client.query(patch);
  assert.deepEqual(await get(inactive.id), beforeReapply);
  assert.equal((await get(historical.id)).activated_at, null);
  console.log('Approval activation timestamps: history preservation, transitions, retries and repeat migration PASS');
};
