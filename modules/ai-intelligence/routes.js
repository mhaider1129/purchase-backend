'use strict';

const express=require('express');
const pool=require('../../config/db');
const {AiAuditService}=require('./aiAuditService');
const {createAiProvider}=require('./aiProviderService');
const {AiToolRegistry}=require('./aiToolRegistry');
const {AiService}=require('./aiService');
const {createAiController}=require('./aiController');
const {createTools}=require('./tools');

function createAiRouter(dependencies={}) {
  if (dependencies.service) {
    const controller=createAiController(dependencies.service);const router=express.Router();router.get('/health',controller.health);router.post('/chat',controller.chat);return router;
  }
  const auditService=dependencies.auditService || new AiAuditService(dependencies.database || pool);
  const registry=dependencies.registry || new AiToolRegistry({tools:createTools(dependencies.database || pool),auditService});
  const provider=dependencies.provider || createAiProvider(dependencies.providerOptions);
  const service=new AiService({provider,registry,auditService});
  const controller=createAiController(service);const router=express.Router();router.get('/health',controller.health);router.post('/chat',controller.chat);return router;
}
module.exports={createAiRouter};