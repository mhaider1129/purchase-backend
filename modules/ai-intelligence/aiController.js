'use strict';

const { validateChat } = require('./validation');

function createAiController(service) {
  return {
    chat:async(req,res,next)=>{try{const response=await service.chat({user:req.user,request:validateChat(req.body)});res.json(response);}catch(error){next(error);}},
    health:async(req,res,next)=>{try{const response=await service.health({user:req.user});res.status(response.status==='available'?200:503).json(response);}catch(error){next(error);}},
  };
}
module.exports={createAiController};