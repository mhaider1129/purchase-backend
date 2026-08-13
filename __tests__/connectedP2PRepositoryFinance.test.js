'use strict';

const { createConnectedP2PRepository } = require('../repositories/connectedP2PRepository');

const clientWith = (...results) => {
  const client={query:jest.fn()};
  results.forEach((result)=>client.query.mockResolvedValueOnce({rows:result,rowCount:result.length}));
  return client;
};

describe('connected P2P finance repository contract',()=>{
  test('locks the sole active PO encumbrance without arbitrarily limiting rows',async()=>{
    const client=clientWith([{id:3}]);
    await expect(createConnectedP2PRepository(client).lockActivePoEncumbrance(2)).resolves.toEqual({id:3});
    expect(client.query.mock.calls[0][0]).toMatch(/stage='encumbrance'.*state='ACTIVE' FOR UPDATE/s);
    expect(client.query.mock.calls[0][0]).not.toMatch(/LIMIT 1/);
  });

  test('fails clearly if corrupt data has multiple active PO encumbrances',async()=>{
    const client=clientWith([{id:3},{id:4}]);
    await expect(createConnectedP2PRepository(client).lockActivePoEncumbrance(2)).rejects.toMatchObject({code:'MULTIPLE_ACTIVE_PO_ENCUMBRANCES'});
  });

  test('actual evidence includes its parent, invoice and voucher',async()=>{
    const client=clientWith([{id:11}]);
    await createConnectedP2PRepository(client).insertCommitmentActualization({id:3,request_id:1,budget_envelope_id:9,purchase_order_id:2,amount:'600.0000',currency:'USD',supplier_invoice_id:4,ap_voucher_id:7,idempotency_key:'actual:7',actor_id:5});
    const [sql,values]=client.query.mock.calls[0];
    expect(sql).toMatch(/stage,state,amount.*parent_commitment_id,supplier_invoice_id,ap_voucher_id/s);
    expect(sql).toMatch(/'actual','ACTIVE'/);
    expect(values).toEqual([1,9,2,'600.0000','USD',7,3,4,'actual:7',5]);
  });

  test('reduction is guarded and makes a zero encumbrance non-active',async()=>{
    const client=clientWith([{id:3,amount:'0',state:'ACTUALIZED'}]);
    await createConnectedP2PRepository(client).reduceActiveEncumbrance(3,'1000');
    const sql=client.query.mock.calls[0][0];
    expect(sql).toMatch(/amount=amount-\$2/);
    expect(sql).toMatch(/WHEN amount-\$2=0 THEN 'ACTUALIZED'/);
    expect(sql).toMatch(/amount >= \$2 AND \$2 >= 0/);
  });

  test('consumed projection is deterministically summed from active actual evidence',async()=>{
    const client=clientWith([{id:9,consumed_amount:'900'}]);
    await createConnectedP2PRepository(client).synchronizeBudgetConsumedProjection(9);
    expect(client.query.mock.calls[0][0]).toMatch(/SET consumed_amount=.*SUM\(amount\).*stage='actual' AND state='ACTIVE'/s);
  });

  test('finds actualization by voucher and detects uniqueness corruption',async()=>{
    const client=clientWith([{id:11}],[{id:11},{id:12}]);
    const repository=createConnectedP2PRepository(client);
    await expect(repository.findActualizationByVoucher(7)).resolves.toEqual({id:11});
    await expect(repository.findActualizationByVoucher(8)).rejects.toMatchObject({code:'MULTIPLE_VOUCHER_ACTUALIZATIONS'});
  });

  test('payment authority follows the persisted payable voucher foreign key',async()=>{
    const client=clientWith([{voucher_status:'posted',ap_voucher_id:7}]);
    await expect(createConnectedP2PRepository(client).loadPayablePostingAuthority(12)).resolves.toMatchObject({ap_voucher_id:7});
    expect(client.query.mock.calls[0][0]).toMatch(/av\.id=ap\.ap_voucher_id/);
  });
});