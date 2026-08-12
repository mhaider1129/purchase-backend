describe('warehouse transfer routes', () => {
  test('exports every handler registered by the router', () => {
    const controller = require('../controllers/warehouseTransfersController');

    expect(controller).toEqual(expect.objectContaining({
      createTransferRequest: expect.any(Function),
      getTransferRequest: expect.any(Function),
      approveTransferRequest: expect.any(Function),
      rejectTransferRequest: expect.any(Function),
      receiveTransferRequest: expect.any(Function),
      cancelTransferRequest: expect.any(Function),
    }));

    expect(() => require('../routes/warehouseTransfers')).not.toThrow();
  });
});