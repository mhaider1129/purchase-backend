const {
  assertBudgetCanCover,
  getBudgetSnapshot,
} = require('../services/financeCoreService');

describe('financeCoreService', () => {
  test('getBudgetSnapshot returns computed amounts', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 11, allocated_amount: 1000, consumed_amount: 0, currency: 'USD' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ reserved: 200, encumbered: 150, actual: 300 }], rowCount: 1 }),
    };

    const snapshot = await getBudgetSnapshot(client, 11);

    expect(snapshot.allocated).toBe(1000);
    expect(snapshot.reserved).toBe(200);
    expect(snapshot.encumbered).toBe(150);
    expect(snapshot.actual).toBe(300);
    expect(snapshot.available).toBe(700);
  });

  test('assertBudgetCanCover rejects when no envelope found', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };

    await expect(
      assertBudgetCanCover(client, {
        departmentId: 1,
        amount: 100,
        currency: 'USD',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('assertBudgetCanCover rejects on insufficient available budget', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 7, department_id: 1, project_id: null, fiscal_year: 2026, currency: 'USD', allocated_amount: 500 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ id: 7, allocated_amount: 500, consumed_amount: 0, currency: 'USD' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ reserved: 0, encumbered: 0, actual: 450 }], rowCount: 1 }),
    };

    await expect(
      assertBudgetCanCover(client, {
        departmentId: 1,
        amount: 100,
        currency: 'USD',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});