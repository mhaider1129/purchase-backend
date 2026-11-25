const {pairs,matches}=require("../scripts/lib/databaseRelease/reviewedAlternatives");
const catalog=require("../scripts/lib/databaseRelease/catalog");
test("reviewed alternatives are exact and preserve other fields",()=>{
 for(const p of pairs){
 expect(matches(p.group,p.expected,p.actual)).toBe(true);
 expect(catalog.compare({[p.group]:[p.expected]},{[p.group]:[p.actual]})).toEqual([]);
 const bad={...p.actual,[p.group==="columns"?"default_expression":"definition"]:"unreviewed"};
 expect(matches(p.group,p.expected,bad)).toBe(false);
 expect(catalog.compare({[p.group]:[p.expected]},{[p.group]:[bad]})).not.toEqual([]);
 expect(matches(p.group,p.expected,{...p.actual,name:"other"})).toBe(false);
 }
});
