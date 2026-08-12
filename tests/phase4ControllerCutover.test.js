
const mockCreatePurchaseOrderFromAwards = jest.fn();
jest.mock('../config/db', () => ({ connect: jest.fn() }));
jest.mock('../services/purchaseOrderService', () => ({ createPurchaseOrderFromAwards: mockCreatePurchaseOrderFromAwards }));
jest.mock('../utils/workflowEmailNotifications', () => ({ sendRequestWorkflowEmail: jest.fn(), sendWorkflowEmail: jest.fn() }));

const controller = require('../controllers/procureToPayController');

describe('live Phase 4 controller cutover', () => {
  test('createPurchaseOrder delegates award quantities to the canonical service', async () => {
    mockCreatePurchaseOrderFromAwards.mockResolvedValue({ id: 44, lines: [] });
    const req = { params: { requestId: '9' }, user: { id: 7, role: 'scm' }, body: { awards: [{ award_id: 2, quantity: '60' }] } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }; const next = jest.fn();
    await controller.createPurchaseOrder(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(mockCreatePurchaseOrderFromAwards).toHaveBeenCalledWith(expect.objectContaining({ awardIds: [2], quantities: { 2: '60' }, actor: req.user }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('createPurchaseOrder rejects legacy arbitrary item pricing input', async () => {
    const next = jest.fn();
    await controller.createPurchaseOrder({ user: { id: 7, role: 'scm' }, body: { items: [{ unit_price: 1 }] } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockCreatePurchaseOrderFromAwards).toHaveBeenCalledTimes(0);
  });
});