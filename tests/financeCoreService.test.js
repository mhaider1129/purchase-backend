const {
  assertBudgetCanCover,
  getBudgetSnapshot,
  createJournalEntry,
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

  test('createJournalEntry persists header and lines', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 99, journal_reference: 'x' }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 1 }),
    };

    const journal = await createJournalEntry(client, {
      requestId: 10,
      journalType: 'accrual',
      sourceType: 'supplier_invoice',
      sourceId: 'INV-1',
      totalAmount: 120,
      lines: [
        { accountCode: '5000-PROC-EXP', debitAmount: 120 },
        { accountCode: '2100-AP-ACCRUAL', creditAmount: 120 },
      ],
    });

    expect(journal.id).toBe(99);
    expect(client.query).toHaveBeenCalledTimes(3);
  });

});