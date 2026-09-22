const service=require('../services/approvalDelegationService');
const actor=req=>({id:req.user?.id||req.user?.userId,instituteId:req.user?.institute_id||req.user?.instituteId});
exports.list=async(req,res,next)=>{try{res.json(await service.list(actor(req)));}catch(e){next(e);}};
exports.create=async(req,res,next)=>{try{res.status(201).json(await service.create(req.body,actor(req)));}catch(e){next(e);}};
exports.revoke=async(req,res,next)=>{try{res.json(await service.revoke(req.params.id,req.body,actor(req)));}catch(e){next(e);}};