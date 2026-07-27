const {validateHeaders,normalizeText,checksumRow,suggestAttributes,scoreCandidate}=require('../services/stockItemIdentityService');
describe('stock item migration normalization',()=>{
 test('validates named headers without relying on positions',()=>expect(validateHeaders(['Description','Stock Item ID','Item Name'])).toMatchObject({source_stock_item_id:'Stock Item ID',source_name:'Item Name'}));
 test('rejects missing required headers',()=>expect(()=>validateHeaders(['Brand'])).toThrow(/Missing required/));
 test('normalizes unicode, dashes, whitespace and units deterministically',()=>expect(normalizeText('  SUTURE—10 millimeters  ')).toBe('suture-10 mm'));
 test('checksum is key-order independent and changes with content',()=>{expect(checksumRow({a:1,b:2})).toBe(checksumRow({b:2,a:1}));expect(checksumRow({a:1})).not.toBe(checksumRow({a:2}));});
 test('extracts governed suggestions with evidence',()=>expect(suggestAttributes('Sterile absorbable suture 3/0 pack of 12')).toEqual(expect.arrayContaining([expect.objectContaining({attribute_key:'sterility',suggested_value:true,normalization_rule:'sterility.v1'}),expect.objectContaining({attribute_key:'absorbability'})])));
 test('candidate result exposes matches, conflicts and explanation',()=>expect(scoreCandidate({name:'Sterile catheter 10 mm',attributes:{sterile:true,size:10}},{id:3,type:'generic_item',name:'Catheter sterile 10mm',attributes:{sterile:true,size:12}})).toMatchObject({candidate_id:3,candidate_type:'generic_item',matching_attributes:['sterile'],conflicting_attributes:['size']}));
});