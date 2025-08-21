const { createRequest } = require('../controllers/requests/createRequestController');

describe('createRequestController.createRequest', () => {
  it('returns 400 when items is not array', async () => {
    const req = { body: { items: 'bad' }, user: { id: 1, department_id: 1 } };
    const res = {};
    const next = jest.fn();
    await createRequest(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('returns 403 when non-warehouse user submits stock request', async () => {
    const req = { body: { request_type: 'Stock', items: [] }, user: { id: 1, department_id: 1, role: 'employee' } };
    const res = {};
    const next = jest.fn();
    await createRequest(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});