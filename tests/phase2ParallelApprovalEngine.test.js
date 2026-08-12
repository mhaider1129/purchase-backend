const fs = require('fs');
const path = require('path');
const { createApprovalEngine } = require('../services/approvalEngine');

const request = { id: 10, requester_id: 99, institute_id: 1, status: 'Pending' };
const member = (id, level, approver, extra = {}) => ({ id, request_id: 10, approval_level: level, approver_id: approver, approval_route_version: 4, route_snapshot_id: 'snap', status: 'Pending', is_active: level === 1, is_superseded: false, ...extra });

function harness(initial, overrides = {}) {
  const rows = initial.map(row => ({ ...row }));
  const notifications = []; const audits = []; const transitions = [];
  const repository = {
    findApproval: async (_client, id) => rows.find(row => row.id === id),
    lockRequest: async () => request,
    lockWorkflow: async () => rows.filter(row => !row.is_superseded && row.approval_route_version === 4).sort((a, b) => a.id - b.id),
    getLevelDecisionSummary: async (_client, _scope, level) => {
      const group = rows.filter(row => row.approval_level === level && !row.is_superseded && row.approval_route_version === 4);
      const count = status => group.filter(row => row.status === status).length;
      return { memberCount: group.length, approvedCount: count('Approved'), rejectedCount: count('Rejected'), returnedCount: count('Returned'), pendingCount: count('Pending') };
    },
    activateLevel: async (_client, _scope, level) => rows.filter(row => row.approval_level === level && row.status === 'Pending' && !row.is_active && !row.is_superseded).map(row => Object.assign(row, { is_active: true })),
    deactivatePendingLevel: async (_client, _scope, level) => rows.filter(row => row.approval_level === level && row.status === 'Pending' && row.is_active).map(row => Object.assign(row, { is_active: false })),
  };
  repository.getNextLevel = async (_client, _scope, level) => {
    const levels = rows.filter(row => row.approval_level > level && row.status === 'Pending' && !row.is_superseded).map(row => row.approval_level);
    return levels.length ? Math.min(...levels) : null;
  };
  const client = { query: jest.fn(async (sql, params) => {
    if (sql.includes('UPDATE approvals SET status=')) {
      const row = rows.find(candidate => candidate.id === params[2]);
      Object.assign(row, { status: params[0], comments: params[1], is_active: false, decided_at: 'now' });
      return { rowCount: 1, rows: [row] };
    }
    if (sql.includes('UPDATE approvals SET approver_id=')) {
      const row = rows.find(candidate => candidate.id === params[1]); Object.assign(row, { approver_id: params[0] });
      return { rowCount: 1, rows: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }) };
  const engine = createApprovalEngine({ repository, policy: async () => true,
    audit: overrides.audit || (async event => audits.push(event)),
    notify: overrides.notify || (async (_client, event) => notifications.push(event)),
    lifecycle: overrides.lifecycle || { transition: async command => { transitions.push(command); return { changed: true, after: command.toStatus }; } } });
  return { rows, notifications, audits, transitions, engine, client };
}

describe('parallel ApprovalEngine groups', () => {
  test('first of two approvals leaves its peer active and does not activate level 2', async () => {
    const h = harness([member(1, 1, 21), member(2, 1, 22), member(3, 2, 23)]);
    const result = await h.engine.decide({ approvalId: 1, decision: 'Approved', actor: { id: 21 } }, h.client);
    expect(result.currentLevelState).toMatchObject({ approvedCount: 1, pendingCount: 1 });
    expect(h.rows.find(row => row.id === 2).is_active).toBe(true);
    expect(h.rows.find(row => row.id === 3).is_active).toBe(false);
    expect(h.transitions).toHaveLength(0);
  });

  test('final member activates every member of the next level and notifies each once', async () => {
    const h = harness([member(1, 1, 21, { status: 'Approved', is_active: false }), member(2, 1, 22), member(3, 2, 23), member(4, 2, 24)]);
    const result = await h.engine.decide({ approvalId: 2, decision: 'Approved', actor: { id: 22 } }, h.client);
    expect(result.nextApprovals.map(row => row.id)).toEqual([3, 4]);
    expect(h.notifications.filter(event => event.type === 'approval.action_required')).toHaveLength(2);
    expect(h.notifications.map(event => event.idempotencyKey)).toEqual(expect.arrayContaining(['approval:3:active:4', 'approval:4:active:4']));
    expect(h.audits.find(event => event.action === 'approval.level_completed').metadata).toMatchObject({ memberCount: 2, approvedCount: 2, pendingCount: 0, nextLevel: 2 });
  });

  test.each(['Rejected', 'Returned'])('%s terminates the cycle and deactivates parallel peers', async decision => {
    const h = harness([member(1, 1, 21), member(2, 1, 22), member(3, 2, 23)]);
    await h.engine.decide({ approvalId: 1, decision, reason: 'Needs correction', actor: { id: 21 } }, h.client);
    expect(h.rows.find(row => row.id === 2).is_active).toBe(false);
    expect(h.rows.find(row => row.id === 3).is_active).toBe(false);
    expect(h.transitions).toHaveLength(1);
    expect(h.transitions[0].toStatus).toBe(decision);
  });

  test('the final member of the final level approves the request once', async () => {
    const h = harness([member(1, 1, 21, { status: 'Approved', is_active: false }), member(2, 1, 22)]);
    await h.engine.decide({ approvalId: 2, decision: 'Approved', actor: { id: 22 } }, h.client);
    expect(h.transitions).toHaveLength(1);
    expect(h.transitions[0].toStatus).toBe('Approved');
  });

  test('superseded and other-version members do not participate in completion', async () => {
    const h = harness([member(1, 1, 21), member(2, 1, 22, { is_superseded: true }), member(3, 1, 23, { approval_route_version: 3 })]);
    await h.engine.decide({ approvalId: 1, decision: 'Approved', actor: { id: 21 } }, h.client);
    expect(h.transitions).toHaveLength(1);
  });

  test('reassignment preserves member identity fields and rejects a duplicate member', async () => {
    const h = harness([member(1, 1, 21), member(2, 1, 22)]);
    await expect(h.engine.reassign({ approvalId: 1, newApproverId: 22, actor: { id: 7 }, reason: 'coverage' }, h.client)).rejects.toMatchObject({ code: 'DUPLICATE_APPROVAL_MEMBER', statusCode: 409 });
    const changed = await h.engine.reassign({ approvalId: 1, newApproverId: 25, actor: { id: 7 }, reason: 'coverage' }, h.client);
    expect(changed).toMatchObject({ approver_id: 25, approval_level: 1, approval_route_version: 4, route_snapshot_id: 'snap' });
  });

  test('engine SQL de-duplicates by the route member identity without requiring a unique index', () => {
    const source = fs.readFileSync(path.join(__dirname, '../services/approvalEngine.js'), 'utf8');
    expect(source).toContain('WHERE NOT EXISTS (');
    expect(source).toContain('approval_route_version=$5');
    expect(source).toContain('approval_level=$3');
    expect(source).toContain('approver_id=$2');
  });

  test('audit and outbox failures propagate so the surrounding transaction can roll back', async () => {
    const auditFailure = harness([member(1, 1, 21)], { audit: async () => { throw new Error('audit failed'); } });
    await expect(auditFailure.engine.decide({ approvalId: 1, decision: 'Approved', actor: { id: 21 } }, auditFailure.client)).rejects.toThrow('audit failed');
    const outboxFailure = harness([member(1, 1, 21)], { notify: async () => { throw new Error('outbox failed'); } });
    await expect(outboxFailure.engine.decide({ approvalId: 1, decision: 'Approved', actor: { id: 21 } }, outboxFailure.client)).rejects.toThrow('outbox failed');
  });
});