// Non-Stock-only excerpt of the owner's supplied export, 2026-10-07.
// Timestamps and unrelated policies omitted. IDs are fixture evidence only,
// never request-specific routing branches or database repair instructions.
const version = { id: 20, approval_policy_id: 19, version_number: 1, status: 'SHADOW', policy: { id: 19, instituteId: 1, name: 'Non-Stock' } };
const rules = [
  { id: 70, policy_version_id: 20, rule_code: 'NONSTOCK_MED_HIGH', priority: 10, is_active: true, stop_processing: true },
  { id: 71, policy_version_id: 20, rule_code: 'NONSTOCK_MED_STANDARD', priority: 20, is_active: true, stop_processing: true },
  { id: 72, policy_version_id: 20, rule_code: 'NONSTOCK_OP_HIGH', priority: 30, is_active: true, stop_processing: true },
  { id: 73, policy_version_id: 20, rule_code: 'NONSTOCK_OP_STANDARD', priority: 40, is_active: true, stop_processing: true },
];
const conditions = [
  [232,70,'REQUEST_TYPE_EQUALS','Non-Stock'], [233,70,'DEPARTMENT_CLASSIFICATION_EQUALS','medical'], [234,70,'IS_NON_STOCK_REQUEST','true'], [235,70,'AMOUNT_GTE','5000001'],
  [236,71,'REQUEST_TYPE_EQUALS','Non-Stock'], [237,71,'DEPARTMENT_CLASSIFICATION_EQUALS','medical'], [238,71,'IS_NON_STOCK_REQUEST','true'], [239,71,'AMOUNT_LT','5000001'],
  [240,72,'REQUEST_TYPE_EQUALS','Non-Stock'], [241,72,'DEPARTMENT_CLASSIFICATION_EQUALS','operational'], [242,72,'IS_NON_STOCK_REQUEST','true'], [243,72,'AMOUNT_GTE','5000001'],
  [244,73,'REQUEST_TYPE_EQUALS','Non-Stock'], [245,73,'DEPARTMENT_CLASSIFICATION_EQUALS','operational'], [246,73,'IS_NON_STOCK_REQUEST','true'], [247,73,'AMOUNT_LT','5000001'],
].map(([id,policy_rule_id,condition_type,condition_value])=>({id,policy_rule_id,condition_group:1,condition_type,condition_value}));
const steps = [
  [223,70,1,'DEPARTMENT_HEAD',null,'DEPARTMENT_AUTHORIZATION'],
  [224,70,2,'POSITION','65:SECTION_HEAD','WAREHOUSE_VALIDATION'],
  [225,70,3,'EXECUTIVE_OWNER',null,'EXECUTIVE_AUTHORIZATION'],
  [226,70,4,'POSITION','21:DEPARTMENT_HEAD','PROCUREMENT_AUTHORIZATION'],
  [227,70,5,'POSITION','96:EXECUTIVE_HEAD','FINANCIAL_REVIEW'],
  [228,70,6,'POSITION','92:EXECUTIVE_HEAD','FINAL_EXECUTIVE_AUTHORIZATION'],
  [229,71,1,'DEPARTMENT_HEAD',null,'DEPARTMENT_AUTHORIZATION'],
  [230,71,2,'POSITION','65:SECTION_HEAD','WAREHOUSE_VALIDATION'],
  [231,71,3,'EXECUTIVE_OWNER',null,'EXECUTIVE_AUTHORIZATION'],
  [232,71,4,'POSITION','21:DEPARTMENT_HEAD','PROCUREMENT_AUTHORIZATION'],
  [233,71,5,'POSITION','92:EXECUTIVE_HEAD','FINAL_EXECUTIVE_AUTHORIZATION'],
  [234,72,1,'DEPARTMENT_HEAD',null,'DEPARTMENT_AUTHORIZATION'],
  [235,72,2,'POSITION','65:SECTION_HEAD','WAREHOUSE_VALIDATION'],
  [236,72,3,'POSITION','21:DEPARTMENT_HEAD','PROCUREMENT_AUTHORIZATION'],
  [237,72,4,'POSITION','96:EXECUTIVE_HEAD','FINANCIAL_REVIEW'],
  [238,72,5,'POSITION','92:EXECUTIVE_HEAD','EXECUTIVE_AUTHORIZATION'],
  [239,73,1,'DEPARTMENT_HEAD',null,'DEPARTMENT_AUTHORIZATION'],
  [240,73,2,'POSITION','65:SECTION_HEAD','WAREHOUSE_VALIDATION'],
  [241,73,3,'POSITION','21:DEPARTMENT_HEAD','PROCUREMENT_AUTHORIZATION'],
  [242,73,4,'POSITION','92:EXECUTIVE_HEAD','EXECUTIVE_AUTHORIZATION'],
].map(([id,policy_rule_id,step_order,resolver_type,resolver_reference,semantic_key])=>({id,policy_rule_id,step_order,approval_level:step_order,resolver_type,resolver_reference,semantic_key,required:true,parallel_group:null}));
module.exports={version,rules,conditions,steps};
