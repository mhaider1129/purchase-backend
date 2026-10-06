jest.mock('../config/db', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../utils/ensureRequestedItemApprovalColumns', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../utils/ensureWarehouseSupplyTables', () => ({ ensureWarehouseSupplyApprovalColumns: jest.fn().mockResolvedValue(undefined), ensureWarehouseSupplyTables: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/getColumnType', () => jest.fn().mockResolvedValue('integer'));
jest.mock('../utils/emailService', () => ({ sendEmail: jest.fn(), buildApprovalActionLinks: jest.fn(), verifyApprovalActionToken: jest.fn() }));
jest.mock('../utils/notificationService', () => ({ createNotifications: jest.fn() }));
jest.mock('../controllers/requests/createRequestController', () => ({ assignApprover: jest.fn() }));
jest.mock('../controllers/utils/approvalRoutes', () => ({ fetchApprovalRoutes: jest.fn(), resolveRouteDomain: jest.fn() }));
jest.mock('../services/requestAutoAssignmentService', () => ({ applyAutoAssignmentForApprovedRequest: jest.fn() }));
jest.mock('../utils/ensureApprovalReminderColumn', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../utils/ensureRequestEditApprovalsTable', () => jest.fn().mockResolvedValue(undefined));

const pool = require('../config/db');
const { handleApprovalDecision, updateApprovalItems } = require('../controllers/approvalsController');
const { fetchApprovalRoutes, resolveRouteDomain } = require('../controllers/utils/approvalRoutes');

const buildResponse = () => {
  const res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

describe('updateApprovalItems warehouse supply conversion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchApprovalRoutes.mockResolvedValue([]);
    resolveRouteDomain.mockResolvedValue('operational');
  });

  it.each([[500, 400, 2.5, 7], [500, 400, null, 7], [400, 300, 2.5, 8], [300, 450, 2.5, 9]])('records quantity %s → %s with unit cost %s by approver %s', async (previousQuantity, nextQuantity, unitCost, actorId) => {
    const totalCost = unitCost === null ? null : nextQuantity * unitCost;
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    client.query.mockImplementation(async (sql, values) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return {};
      if (/FROM approvals[\s\S]*FOR UPDATE/.test(sql)) return { rows: [{ id: 88, request_id: 353, approver_id: actorId, is_active: true, status: 'Pending' }] };
      if (/SELECT request_type, estimated_cost FROM requests/.test(sql)) return { rowCount: 1, rows: [{ request_type: 'Stock', estimated_cost: unitCost === null ? 0 : previousQuantity * unitCost }] };
      if (/FROM public\.requested_items\s+WHERE id =/.test(sql)) return { rowCount: 1, rows: [{ id: 12, item_name: 'Gloves', quantity: previousQuantity, unit_cost: unitCost, total_cost: unitCost === null ? null : previousQuantity * unitCost, approval_status: 'Pending' }] };
      if (/UPDATE public\.requested_items[\s\S]*SET quantity/.test(sql)) {
        expect(values).toEqual([nextQuantity, 12, 353]);
        expect(sql).toContain('quantity = $1::numeric');
        expect(sql).toContain('unit_cost * $1::numeric');
        expect(sql).not.toContain('updated_at');
        return { rows: [{ quantity: nextQuantity, unit_cost: unitCost, total_cost: totalCost }] };
      }
      if (/UPDATE public\.requested_items[\s\S]*SET approval_status/.test(sql)) return { rows: [{ id: 12, item_name: 'Gloves', quantity: nextQuantity, unit_cost: unitCost, total_cost: totalCost, approval_status: 'Pending', approved_by: null }] };
      if (/SELECT\s+COUNT\(\*\) FILTER/.test(sql)) return { rows: [{ approved: 0, rejected: 0, pending: 1 }] };
      if (/SELECT COALESCE\(SUM/.test(sql)) return { rows: [{ total: totalCost ?? 0 }] };
      if (/INSERT INTO public\.(request_logs|approval_logs)/.test(sql) || /UPDATE requests\s+SET estimated_cost/.test(sql)) return {};
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const res = buildResponse();
    const next = jest.fn();
    await updateApprovalItems({ params: { id: '88' }, body: { items: [{ item_id: 12, status: 'Pending', quantity: nextQuantity }] }, user: { id: actorId } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updatedItems: [expect.objectContaining({ quantity: nextQuantity, total_cost: totalCost })], updatedEstimatedCost: totalCost ?? 0 }));
    const quantityComment = `1 item(s) quantity adjusted: Gloves (#12): ${previousQuantity} → ${nextQuantity}`;
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public.approval_logs'), [88, 353, actorId, quantityComment]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public.request_logs'), [353, actorId, quantityComment]);
    expect(client.query).toHaveBeenCalledWith(expect.stringMatching(/FROM public\.requested_items[\s\S]*FOR UPDATE/), [12, 353]);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('creates converted warehouse supply requests and items as approved for immediate fulfillment', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);

    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (/FROM approvals[\s\S]*FOR UPDATE/.test(sql)) return { rowCount: 1, rows: [{ id: 88, request_id: 353, approver_id: 7, is_active: true, status: 'Pending' }] };
      if (/SELECT request_type, estimated_cost FROM requests/.test(sql)) return { rowCount: 1, rows: [{ request_type: 'Stock', estimated_cost: 0 }] };
      if (/FROM public\.requested_items\s+WHERE id =/.test(sql)) return { rowCount: 1, rows: [{ id: 12, item_name: 'Wheelchair', quantity: 1, unit_cost: null, total_cost: null, approval_status: 'Pending', approval_comments: null, approved_by: null }] };
      if (/UPDATE public\.requested_items[\s\S]*SET approval_status/.test(sql)) return { rowCount: 1, rows: [{ id: 12, item_name: 'Wheelchair', approval_status: 'Rejected', approval_comments: 'In stock', approved_at: new Date(), approved_by: 7, quantity: 1, total_cost: null, unit_cost: null }] };
      if (/SELECT requester_id, department_id/.test(sql)) return { rowCount: 1, rows: [{ requester_id: 4, department_id: 2, institute_id: 1, section_id: 3, project_id: null, request_domain: 'operational', justification: 'Need wheelchair' }] };
      if (/INSERT INTO requests/.test(sql)) return { rowCount: 1, rows: [{ id: 380 }] };
      if (/INSERT INTO warehouse_supply_items/.test(sql)) return { rowCount: 1, rows: [] };
      if (/COUNT\(\*\) AS total[\s\S]*available_in_stock/.test(sql)) return { rows: [{ total: '1', available_in_stock: '1' }] };
      if (/UPDATE approvals/.test(sql)) return { rowCount: 1, rows: [] };
      if (/UPDATE requests[\s\S]*SET status/.test(sql)) return { rowCount: 1, rows: [] };
      if (/INSERT INTO request_logs/.test(sql)) return { rowCount: 1, rows: [] };
      if (/SELECT\s+COUNT\(\*\) FILTER/.test(sql)) return { rowCount: 1, rows: [{ approved: 0, rejected: 1, pending: 0 }] };
      if (/INSERT INTO public\.request_logs/.test(sql)) return { rowCount: 1, rows: [] };
      if (/INSERT INTO public\.approval_logs/.test(sql)) return { rowCount: 1, rows: [] };
      if (/SELECT COALESCE\(SUM/.test(sql)) return { rowCount: 1, rows: [{ total: 0 }] };
      if (/UPDATE requests\s+SET estimated_cost/.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const req = { params: { id: '88' }, body: { items: [{ item_id: 12, status: 'Rejected', convert_to_warehouse_supply: true, comments: 'In stock' }] }, user: { id: 7, role: 'WAREHOUSEMANAGER', warehouse_id: 5, name: 'Warehouse User' } };
    const res = buildResponse();
    const next = jest.fn();

    await updateApprovalItems(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("'Approved', $7, $8, $9"), expect.arrayContaining([5, 7]));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('approval_status, approved_by, approved_at'), [380, 12, 'Wheelchair', 1, 7]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'Approved'"),
      [88],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND status IN ('Pending', 'On Hold')"),
      [353, 88],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status = $1'),
      ['Available in Stock', 353],
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      warehouseSupplyRequestId: 380,
      updatedRequestStatus: 'Available in Stock',
    }));
  });

  it.each(['Approved', 'Rejected'])(
    'closes an all-in-stock request after the Warehouse Manager marks it %s',
    async (decision) => {
      const client = { query: jest.fn(), release: jest.fn() };
      pool.connect.mockResolvedValue(client);

      client.query.mockImplementation(async (sql) => {
        const statement = String(sql);
        if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return {};
        if (/SELECT \* FROM approvals WHERE id/.test(statement)) {
          return { rows: [{ id: 88, request_id: 353, approver_id: 7, approval_level: 2, status: 'Pending', is_active: true }] };
        }
        if (/SELECT r\.\*, p\.name AS project_name/.test(statement)) {
          return { rows: [{ id: 353, request_type: 'Stock', requester_id: 4, requester_email: null, department_id: 2, estimated_cost: 0, status: 'Submitted' }] };
        }
        if (/SELECT scm_approval\.id/.test(statement)) return { rows: [] };
        if (/COUNT\(\*\) AS total[\s\S]*available_in_stock/.test(statement)) {
          return { rows: [{ total: '2', available_in_stock: '2' }] };
        }
        if (/SELECT status FROM approvals/.test(statement)) {
          return { rows: [{ status: decision }, { status: 'Pending' }] };
        }
        if (/COUNT\(\*\) FILTER \(WHERE approval_status = 'Approved'\)/.test(statement)) {
          return { rowCount: 1, rows: [{ approved: 0, rejected: 2, pending: 0 }] };
        }
        return { rowCount: 1, rows: [] };
      });

      const req = {
        params: { id: '88' },
        body: { status: decision },
        user: { id: 7, role: 'WarehouseManager', department_id: 2 },
      };
      const res = buildResponse();
      const next = jest.fn();

      await handleApprovalDecision(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('AND status IN (\'Pending\', \'On Hold\')'),
        [353, 88],
      );
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE requests SET status = $1'),
        ['Available in Stock', 353],
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        updatedRequestStatus: 'Available in Stock',
      }));
      expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    },
  );
});
