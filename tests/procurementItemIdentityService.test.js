const { validateRequestItemIdentity } = require('../services/procurementItemIdentityService');

const user=(permissions=[])=>({hasPermission:code=>permissions.includes(code)});
const generic={id:4,item_code:'MED-4',generic_name:'Sodium Chloride',canonical_description:'IV solution 0.9%',inventory_uom:'BAG',interchangeability_policy:'fully_interchangeable'};

test('physical non-stock line receives authoritative Generic Item snapshots',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rowCount:1,rows:[generic]})};
  const result=await validateRequestItemIdentity(client,{request_mode:'generic_item',generic_item_id:4,item_name:'user text',stocking_policy:'non_stock'},user());
  expect(result).toMatchObject({generic_item_id:4,item_name:'user text',item_name_snapshot:'user text',catalog_status:'catalogued',stocking_policy:'non_stock'});
});

test('inactive Generic Item is rejected',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rowCount:0,rows:[]})};
  await expect(validateRequestItemIdentity(client,{request_mode:'generic_item',generic_item_id:4,item_name:'x'},user())).rejects.toMatchObject({statusCode:400});
});

test('preferred and mandatory products must belong to the Generic Item',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rowCount:1,rows:[generic]}).mockResolvedValueOnce({rowCount:0,rows:[]})};
  await expect(validateRequestItemIdentity(client,{request_mode:'generic_item_with_preference',generic_item_id:4,preferred_product_id:8,item_name:'x'},user())).rejects.toThrow(/belong/);
});

test('service mode has no physical identity and free text is permission gated',async()=>{
  const service=await validateRequestItemIdentity({query:jest.fn()},{request_mode:'service',item_name:'Calibration'},user());
  expect(service).toMatchObject({generic_item_id:null,stocking_policy:'service'});
  await expect(validateRequestItemIdentity({query:jest.fn()},{request_mode:'approved_free_text_exception',item_name:'Rare item',restriction_justification:'Emergency'},user())).rejects.toMatchObject({statusCode:403});
});

test('specific product requires restriction justification',async()=>{
  const client={query:jest.fn().mockResolvedValueOnce({rowCount:1,rows:[generic]})};
  await expect(validateRequestItemIdentity(client,{request_mode:'specific_approved_product',generic_item_id:4,mandatory_product_id:8,item_name:'x'},user())).rejects.toThrow(/restriction_justification/);
});