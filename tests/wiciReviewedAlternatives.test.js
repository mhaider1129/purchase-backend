const {pairs,matches}=require("../scripts/lib/databaseRelease/reviewedAlternatives");
const catalog=require("../scripts/lib/databaseRelease/catalog");
const options={profile:"wici-2026-11",uuidVerified:true};
test("reviewed alternatives are exact, profile scoped and preserve other fields",()=>{
 for(const p of pairs){
 const expected={[p.group]:[p.expected]},actual={[p.group]:[p.actual]};
 expect(matches(p.group,p.expected,p.actual,options)).toBe(true);
 expect(catalog.compare(expected,actual,options)).toEqual([]);
 for(const scope of [{},{profile:"canonical",uuidVerified:true},{profile:"other",uuidVerified:true}]){
 expect(catalog.compare(expected,actual,scope)).not.toEqual([]);
 }
 if(p.group==="columns") expect(catalog.compare(expected,actual,{profile:options.profile})).not.toEqual([]);
 const bad={...p.actual,[p.group==="columns"?"default_expression":"definition"]:"unreviewed"};
 expect(matches(p.group,p.expected,bad,options)).toBe(false);
 expect(catalog.compare(expected,{[p.group]:[bad]},options)).not.toEqual([]);
 }
});
