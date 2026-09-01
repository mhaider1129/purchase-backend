const pool = require('../config/db');
const db = client => client || pool;
const fields = `u.*,d.name department_name,s.name section_name,p.name parent_name`;
async function list(filters={}, client) {
  const values=[]; const where=[];
  const add=(sql,v)=>{values.push(v);where.push(sql.replace('?',`$${values.length}`));};
  if(filters.type)add('u.unit_type=?',filters.type.toUpperCase());
  if(filters.parent!==undefined)add('u.parent_unit_id IS NOT DISTINCT FROM ?',filters.parent||null);
  if(filters.institute)add('u.institute_id=?',filters.institute);
  if(filters.active!==undefined)add('u.is_active=?',String(filters.active)!=='false');
  if(filters.classification)add('LOWER(u.classification)=LOWER(?)',filters.classification);
  if(filters.search){values.push(`%${filters.search}%`);where.push(`(u.name ILIKE $${values.length} OR u.code ILIKE $${values.length})`);}
  const result=await db(client).query(`SELECT ${fields} FROM organization_units u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN sections s ON s.id=u.section_id LEFT JOIN organization_units p ON p.id=u.parent_unit_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY u.sort_order,u.name`,values);
  return result.rows;
}
async function get(id,client,options={}){const lock=options.lock?' FOR UPDATE OF u':'';const r=await db(client).query(`SELECT ${fields} FROM organization_units u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN sections s ON s.id=u.section_id LEFT JOIN organization_units p ON p.id=u.parent_unit_id WHERE u.id=$1${lock}`,[id]);return r.rows[0];}
async function ancestors(id,client){const r=await db(client).query(`WITH RECURSIVE a AS (SELECT *,0 depth FROM organization_units WHERE id=$1 UNION ALL SELECT p.*,a.depth+1 FROM organization_units p JOIN a ON a.parent_unit_id=p.id) SELECT * FROM a WHERE id<>$1 ORDER BY depth DESC`,[id]);return r.rows;}
async function descendants(id,client){const r=await db(client).query(`WITH RECURSIVE d AS (SELECT *,0 depth FROM organization_units WHERE id=$1 UNION ALL SELECT c.*,d.depth+1 FROM organization_units c JOIN d ON c.parent_unit_id=d.id) SELECT * FROM d WHERE id<>$1 ORDER BY depth,sort_order,name`,[id]);return r.rows;}
async function positions(id,client){const r=await db(client).query(`SELECT p.*,u.name user_name,u.email user_email FROM organization_positions p LEFT JOIN users u ON u.id=p.user_id WHERE organization_unit_id=$1 ORDER BY is_active DESC,is_unit_head DESC,id`,[id]);return r.rows;}
module.exports={pool,list,get,ancestors,descendants,positions,db};