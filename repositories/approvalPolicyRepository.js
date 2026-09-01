const pool=require('../config/db');
const query=(text,params=[],client=pool)=>client.query(text,params);
module.exports={pool,query,
  listPolicies:(instituteId)=>query(`SELECT p.*,v.id shadow_version_id,v.version_number shadow_version_number,v.status shadow_status FROM approval_policies p LEFT JOIN LATERAL (SELECT * FROM approval_policy_versions WHERE approval_policy_id=p.id AND status='SHADOW' ORDER BY version_number DESC LIMIT 1)v ON true WHERE ($1::int IS NULL OR p.institute_id=$1) ORDER BY p.updated_at DESC`,[instituteId]),
  getPolicy:id=>query('SELECT * FROM approval_policies WHERE id=$1',[id]),
  getVersions:id=>query('SELECT * FROM approval_policy_versions WHERE approval_policy_id=$1 ORDER BY version_number DESC',[id]),
  getVersion:id=>query(`SELECT v.*,p.institute_id,p.code policy_code,p.name policy_name,COALESCE(json_agg(DISTINCT jsonb_build_object('id',r.id,'code',r.rule_code,'name',r.name,'priority',r.priority,'isActive',r.is_active,'stopProcessing',r.stop_processing)) FILTER(WHERE r.id IS NOT NULL),'[]') rules_summary FROM approval_policy_versions v JOIN approval_policies p ON p.id=v.approval_policy_id LEFT JOIN approval_policy_rules r ON r.policy_version_id=v.id WHERE v.id=$1 GROUP BY v.id,p.id`,[id]),
};