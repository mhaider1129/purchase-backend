jest.mock('../config/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const {
  __contractApprovalInternals,
} = require('../controllers/contractsController');

const {
  getContractApprovalRoleAliases,
  canUserDecideContractStep,
  activateNextResolvableContractApproval,
  buildContractApprovalChain,
} = __contractApprovalInternals;

describe('contract approval workflow assignment', () => {
  it('maps finance approvals to CFO users and executive approvals to COO users', () => {
    expect(getContractApprovalRoleAliases('finance')).toEqual(['finance', 'cfo']);
    expect(getContractApprovalRoleAliases('coo_ceo')).toEqual(['coo', 'ceo', 'coo_ceo', 'coo/ceo']);
    expect(canUserDecideContractStep({ id: 7, role: 'CFO' }, { reviewer_role: 'finance' })).toBe(true);
    expect(canUserDecideContractStep({ id: 8, role: 'COO' }, { reviewer_role: 'coo_ceo' })).toBe(true);
    expect(canUserDecideContractStep({ id: 9, role: 'CFO' }, { reviewer_id: null, reviewer_role: 'finance' })).toBe(true);
  });



  it('builds one technical approval step per selected technical department', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.includes('FROM departments')) {
        return {
          rows: [
            { id: 11, name: 'Pharmacy' },
            { id: 12, name: 'Radiology' },
          ],
        };
      }
      return { rows: [] };
    });

    const chain = await buildContractApprovalChain(
      { query },
      { technical_department_ids: [11, 12] }
    );

    expect(chain.map((step) => step.stage)).toEqual([
      'Legal Review',
      'Finance Review',
      'Technical Review - Pharmacy',
      'Technical Review - Radiology',
      'SCM Review',
      'COO/CEO Approval',
    ]);
    expect(chain.map((step) => step.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(chain.filter((step) => step.reviewer_role === 'technical').map((step) => step.reviewer_department_id)).toEqual([11, 12]);
  });

  it('skips pending levels without active reviewers and activates the next level that has one', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('FROM contract_approvals') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            { id: 101, approval_level: 1, reviewer_role: 'legal', reviewer_id: null },
            { id: 102, approval_level: 2, reviewer_role: 'finance', reviewer_id: null },
          ],
        };
      }

      if (sql.includes('SELECT id, is_active') && params[0].includes('legal')) {
        return { rows: [{ id: 201, is_active: false }] };
      }

      if (sql.includes('SELECT id, is_active') && params[0].includes('cfo')) {
        return { rows: [{ id: 202, is_active: true }] };
      }

      if (sql.includes('WHERE is_active = TRUE') && params[0].includes('legal')) {
        return { rows: [] };
      }

      if (sql.includes('WHERE is_active = TRUE') && params[0].includes('cfo')) {
        return { rows: [{ id: 202 }] };
      }

      return { rows: [] };
    });

    const result = await activateNextResolvableContractApproval({ query }, 55, 0);

    expect(result).toEqual({ activated: true, approvalId: 102, approvalLevel: 2 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET reviewer_id = $1, is_active = TRUE'),
      [202, 102]
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('SET reviewer_id = $1, is_active = TRUE'),
      [201, 101]
    );
  });

  it('prefers an active HOD from the technical department over other department users', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('FROM contract_approvals') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 103, approval_level: 3, reviewer_role: 'technical', reviewer_department_id: 44, reviewer_id: null }] };
      }

      if (sql.includes('FROM users') && sql.includes('department_id = $1')) {
        expect(params[0]).toBe(44);
        return { rows: [{ id: 301, is_active: true, role: 'HOD', department_id: 44 }] };
      }

      return { rows: [] };
    });

    const result = await activateNextResolvableContractApproval({ query }, 55, 2);

    expect(result).toEqual({ activated: true, approvalId: 103, approvalLevel: 3 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SET reviewer_id = $1, is_active = TRUE'),
      [301, 103]
    );
  });
});