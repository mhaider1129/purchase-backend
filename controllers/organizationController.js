const service=require('../services/organizationService').createOrganizationService();
const reconciliation=require('../services/organizationReconciliationService').createOrganizationReconciliationService();
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
const actor=(req,p={})=>({...p,instituteId:req.user.institute_id,actorId:req.user.id});
const scope=(req,p={})=>({...p,instituteId:req.user.institute_id});
const scopedUnit=async(req,id=req.params.id)=>{const unit=await service.repo.get(id);if(!unit||String(unit.institute_id)!==String(req.user.institute_id)){const error=new Error('Organization unit not found');error.statusCode=404;throw error;}return unit;};
const scopedPosition=async(req)=>{const position=await service.repo.getPosition(req.params.positionId);if(!position||String(position.institute_id)!==String(req.user.institute_id)){const error=new Error('Organization position not found');error.statusCode=404;throw error;}return position;};
exports.tree=wrap(async(req,res)=>res.json(await service.tree(scope(req,req.query))));
exports.list=wrap(async(req,res)=>res.json(await service.repo.list(scope(req,req.query))));
exports.options=wrap(async(req,res)=>{
  const instituteId=req.user.institute_id;
  const [departments,sections,users,positions]=await Promise.all([
    service.repo.db().query('SELECT id,name FROM departments WHERE institute_id=$1 ORDER BY name',[instituteId]),
    service.repo.db().query('SELECT s.id,s.name,d.name AS department_name FROM sections s JOIN departments d ON d.id=s.department_id WHERE d.institute_id=$1 ORDER BY d.name,s.name',[instituteId]),
    service.repo.db().query('SELECT id,name,email FROM users WHERE institute_id=$1 AND is_active=TRUE ORDER BY name',[instituteId]),
    service.repo.db().query(`SELECT op.id,ou.id AS unit_id,ou.name AS unit_name,op.position_name,op.position_type,
      ou.id::text||':'||op.position_type AS reference
      FROM organization_positions op JOIN organization_units ou ON ou.id=op.organization_unit_id
      WHERE ou.institute_id=$1 AND ou.is_active=TRUE AND op.is_active=TRUE
      ORDER BY ou.name,op.position_name`,[instituteId])
  ]);
  res.json({departments:departments.rows,sections:sections.rows,users:users.rows,positions:positions.rows});
});
exports.detail=wrap(async(req,res)=>{await scopedUnit(req);res.json(await service.detail(req.params.id));});
exports.create=wrap(async(req,res)=>res.status(201).json(await service.create(actor(req,req.body))));
exports.update=wrap(async(req,res)=>{await scopedUnit(req);res.json(await service.update(req.params.id,actor(req,req.body)));});
exports.archive=wrap(async(req,res)=>{await scopedUnit(req);res.json(await service.archive(req.params.id,req.user.id));});
exports.move=wrap(async(req,res)=>{await scopedUnit(req);res.json(await service.moveUnit(req.params.id,req.body.parentUnitId??null,req.user.id));});
exports.positions=wrap(async(req,res)=>{await scopedUnit(req);res.json(await service.repo.positions(req.params.id));});
exports.createPosition=wrap(async(req,res)=>{await scopedUnit(req);res.status(201).json(await service.savePosition(req.params.id,actor(req,req.body)));});
exports.assignHead=wrap(async(req,res)=>{await scopedUnit(req);res.status(201).json(await service.assignHead(req.params.id,actor(req,req.body)));});
exports.updatePosition=wrap(async(req,res)=>{await scopedPosition(req);res.json(await service.savePosition(null,actor(req,req.body),req.params.positionId));});
exports.archivePosition=wrap(async(req,res)=>{await scopedPosition(req);res.json(await service.savePosition(null,actor(req,{isActive:false}),req.params.positionId));});
exports.resolve=wrap(async(req,res)=>{const department=(await service.repo.db().query('SELECT * FROM departments WHERE id=$1 AND institute_id=$2',[req.params.departmentId,req.user.institute_id])).rows[0];if(!department)return res.status(404).json({message:'Department not found'});const units=await service.repo.list({institute:req.user.institute_id});const unit=units.find(x=>String(x.department_id)===String(department.id));if(!unit)return res.json({department,orgUnit:null,departmentHead:null,executiveOwner:null,ancestors:[],path:[]});const detail=await service.detail(unit.id);res.json({department,orgUnit:unit,departmentHead:await service.resolveDepartmentHead(department.id),executiveOwner:detail.executiveOwner,ancestors:detail.ancestors,path:detail.path});});
exports.reconciliation=wrap(async(req,res)=>res.json(await reconciliation.list(req.user.institute_id)));
exports.reconciliationPreview=wrap(async(req,res)=>res.json(await reconciliation.bulkPreview(req.user.institute_id)));
exports.assignLegacyHead=wrap(async(req,res)=>{const checked=await reconciliation.assign({instituteId:req.user.institute_id,unitId:req.params.id,userId:req.body.userId,actorId:req.user.id,reason:req.body.reason,fromLegacy:req.body.fromLegacy===true});res.status(201).json(await service.assignHead(req.params.id,{userId:checked.userId,actorId:req.user.id,reason:checked.reason,auditAction:req.body.fromLegacy?'ORGANIZATION_HEAD_ASSIGNED_FROM_LEGACY':'ORGANIZATION_HEAD_MANUALLY_ASSIGNED'}));});
exports.resolveReconciliation=wrap(async(req,res)=>{const unit=await scopedUnit(req);if(unit.unit_type!=='DEPARTMENT')return res.status(400).json({message:'Head reconciliation applies only to departments'});const rows=await reconciliation.list(req.user.institute_id),row=rows.find(x=>String(x.unitId)===String(unit.id));const decisions=['KEEP_EXISTING','MARK_LEGACY_OBSOLETE'];if(!decisions.includes(req.body.decision))return res.status(400).json({message:'Invalid reconciliation decision'});await reconciliation.audit({entityType:'organization_unit',entityId:unit.id,action:'ORGANIZATION_HEAD_CONFLICT_RESOLVED',actorUserId:req.user.id,beforeData:{legacyCandidates:row.legacyCandidates,currentOrganizationHead:row.currentOrganizationHead},afterData:{decision:req.body.decision},metadata:{reason:req.body.reason||null}});res.json({status:'NO_ACTION_REQUIRED',decision:req.body.decision});});
exports.bulkReconcile=wrap(async(req,res)=>{const preview=await reconciliation.bulkPreview(req.user.institute_id);const requested=new Set((req.body.unitIds||preview.map(x=>x.unitId)).map(String));const results=[];for(const row of preview.filter(x=>requested.has(String(x.unitId))))results.push(await service.assignHead(row.unitId,{userId:row.legacyCandidates[0].id,actorId:req.user.id,auditAction:'ORGANIZATION_HEAD_RECONCILED',reason:'Bulk safe legacy HOD reconciliation'}));res.json({assigned:results.length,results});});