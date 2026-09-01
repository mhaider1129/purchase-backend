const service=require('../services/organizationService').createOrganizationService();
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
const actor=(req,p={})=>({...p,instituteId:req.user.institute_id,actorId:req.user.id});
const scope=(req,p={})=>({...p,instituteId:req.user.institute_id});
exports.tree=wrap(async(req,res)=>res.json(await service.tree(scope(req,req.query))));
exports.list=wrap(async(req,res)=>res.json(await service.repo.list(scope(req,req.query))));
exports.options=wrap(async(req,res)=>{
  const instituteId=req.user.institute_id;
  const [departments,sections,users]=await Promise.all([
    service.repo.db().query('SELECT id,name FROM departments WHERE institute_id=$1 ORDER BY name',[instituteId]),
    service.repo.db().query('SELECT s.id,s.name,d.name AS department_name FROM sections s JOIN departments d ON d.id=s.department_id WHERE d.institute_id=$1 ORDER BY d.name,s.name',[instituteId]),
    service.repo.db().query('SELECT id,name,email FROM users WHERE institute_id=$1 AND is_active=TRUE ORDER BY name',[instituteId])
  ]);
  res.json({departments:departments.rows,sections:sections.rows,users:users.rows});
});
exports.detail=wrap(async(req,res)=>res.json(await service.detail(req.params.id)));
exports.create=wrap(async(req,res)=>res.status(201).json(await service.create(actor(req,req.body))));
exports.update=wrap(async(req,res)=>res.json(await service.update(req.params.id,actor(req,req.body))));
exports.archive=wrap(async(req,res)=>res.json(await service.archive(req.params.id,req.user.id)));
exports.move=wrap(async(req,res)=>res.json(await service.moveUnit(req.params.id,req.body.parentUnitId??null,req.user.id)));
exports.positions=wrap(async(req,res)=>res.json(await service.repo.positions(req.params.id)));
exports.createPosition=wrap(async(req,res)=>res.status(201).json(await service.savePosition(req.params.id,actor(req,req.body))));
exports.updatePosition=wrap(async(req,res)=>res.json(await service.savePosition(null,actor(req,req.body),req.params.positionId)));
exports.archivePosition=wrap(async(req,res)=>res.json(await service.savePosition(null,actor(req,{positionType:req.body?.positionType||'CUSTOM',isActive:false}),req.params.positionId)));
exports.resolve=wrap(async(req,res)=>{const department=(await service.repo.db().query('SELECT * FROM departments WHERE id=$1',[req.params.departmentId])).rows[0];if(!department)return res.status(404).json({message:'Department not found'});const units=await service.repo.list({});const unit=units.find(x=>String(x.department_id)===String(department.id));if(!unit)return res.json({department,orgUnit:null,departmentHead:null,executiveOwner:null,ancestors:[],path:[]});const detail=await service.detail(unit.id);res.json({department,orgUnit:unit,departmentHead:await service.resolveDepartmentHead(department.id),executiveOwner:detail.executiveOwner,ancestors:detail.ancestors,path:detail.path});});