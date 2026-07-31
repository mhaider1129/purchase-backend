const pool = require('../config/db');
const { StockItemIdentityService } = require('../services/stockItemIdentityService');
const { StockItemMappingService } = require('../services/stockItemMappingService');
const identityService=new StockItemIdentityService(pool);const mappingService=new StockItemMappingService(pool);
const action=(handler)=>async(req,res,next)=>{try{await handler(req,res);}catch(error){next(error);}};
const transitionInput=(req)=>({stockItemId:Number(req.body.stock_item_id),mappingId:Number(req.params.mappingId),expectedVersion:req.body.expected_version,reason:req.body.reason});
module.exports={
 add:action(async(req,res)=>res.status(201).json(await identityService.addToInventory(req.body,req.user.id))),
 list:action(async(req,res)=>res.json(await mappingService.list(req.query))),
 history:action(async(req,res)=>res.json(await mappingService.history(Number(req.params.stockItemId),req.query))),
 detail:action(async(req,res)=>res.json(await mappingService.detail(Number(req.params.mappingId)))),
 coverage:action(async(_req,res)=>res.json(await mappingService.coverage())),
 propose:action(async(req,res)=>res.status(201).json(await mappingService.propose(req.body,req.user.id))),
 review:action(async(req,res)=>res.json(await mappingService.review(transitionInput(req),req.user.id))),
 approve:action(async(req,res)=>res.json(await mappingService.approve(transitionInput(req),req.user.id))),
 reject:action(async(req,res)=>res.json(await mappingService.reject(transitionInput(req),req.user.id))),
 markDuplicate:action(async(req,res)=>res.json(await mappingService.mark(transitionInput(req),'duplicate',req.user.id))),
 markObsolete:action(async(req,res)=>res.json(await mappingService.mark(transitionInput(req),'obsolete',req.user.id))),
 exclude:action(async(req,res)=>res.json(await mappingService.mark(transitionInput(req),'excluded',req.user.id))),
 supersede:action(async(req,res)=>res.json(await mappingService.supersede({stockItemId:Number(req.params.stockItemId),mappingId:Number(req.params.mappingId),expectedCurrentMappingId:req.body.expected_current_mapping_id,expectedVersion:req.body.expected_version,replacementMappingId:req.body.replacement_mapping_id,reason:req.body.reason},req.user.id))),
 rollback:action(async(req,res)=>res.json(await mappingService.rollback({stockItemId:Number(req.params.stockItemId),mappingId:Number(req.params.mappingId),expectedCurrentMappingId:req.body.expected_current_mapping_id,expectedVersion:req.body.expected_version,restoreMappingId:req.body.restore_mapping_id,reason:req.body.reason},req.user.id))),
};