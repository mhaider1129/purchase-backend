const {FixedAssetService,context}=require('../services/fixedAssetService');
const service=new FixedAssetService();
const send=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){next(e);}};
module.exports={
 options:send(req=>service.options()), dashboard:send(req=>require('../services/rfidService').RfidService.prototype.dashboard.call(new (require('../services/rfidService').RfidService)(),context(req.user))),
 list:send(req=>service.list(req.query,context(req.user))), get:send(req=>service.get(req.params.id,context(req.user))),
 create:async(req,res,next)=>{try{res.status(201).json(await service.create(req.body,context(req.user)));}catch(e){next(e);}},
 update:send(req=>service.update(req.params.id,req.body,context(req.user))), categories:send(req=>service.categories(context(req.user))), locations:send(req=>service.locations(context(req.user))),
 saveLocation:async(req,res,next)=>{try{res.status(req.params.id?200:201).json(await service.saveLocation(req.params.id,req.body,context(req.user)));}catch(e){next(e);}},
 movements:send(req=>service.movements(req.params.id,context(req.user))), requestMovement:async(req,res,next)=>{try{res.status(201).json(await service.requestMovement(req.params.id,req.body,context(req.user)));}catch(e){next(e);}},
 transitionMovement:send(req=>service.transitionMovement(req.params.id,req.body.status,context(req.user))),
};