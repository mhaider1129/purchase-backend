const mockCreatePurchaseOrderFromAwards = jest.fn();
const mockSubmitPurchaseOrder = jest.fn();
const mockApprovePurchaseOrder = jest.fn();
const mockReleasePurchaseOrder = jest.fn();
jest.mock('../config/db', () => ({ connect: jest.fn() }));
jest.mock('../services/purchaseOrderService', () => ({ createPurchaseOrderFromAwards: mockCreatePurchaseOrderFromAwards, submitPurchaseOrder: mockSubmitPurchaseOrder, approvePurchaseOrder: mockApprovePurchaseOrder, releasePurchaseOrder: mockReleasePurchaseOrder }));
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

  test('issue delegates the parsed identity and authoritative load to the service', async () => {
    mockReleasePurchaseOrder.mockResolvedValue({ purchaseOrder: { id: 44, status: 'PO_ISSUED' }, commitment: { id: 3 } });
    const req = { params: { poId: '44' }, user: { id: 7, role: 'scm' }, body: {} };
    const res = { json: jest.fn() }; const next = jest.fn();
    await controller.issuePurchaseOrder(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(mockReleasePurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({ purchaseOrderId: 44, actor: req.user }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ purchase_order: expect.objectContaining({ status: 'PO_ISSUED' }) }));
  });

  test('approval keeps controller authority enforcement', async () => {
    const next = jest.fn();
    await controller.approvePurchaseOrder({ params: { poId: '44' }, user: { id: 7, role: 'buyer' }, body: {} }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockApprovePurchaseOrder).not.toHaveBeenCalled();
  });
});