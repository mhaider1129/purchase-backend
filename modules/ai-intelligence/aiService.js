'use strict';

const crypto = require('crypto');
const { buildAiContext } = require('./aiContextService');
const { requirePermissions } = require('./aiPermissionService');
const { SYSTEM_INSTRUCTION } = require('./policy');

class AiService {
  constructor({ provider, registry, auditService }) { this.provider=provider;this.registry=registry;this.auditService=auditService; }
  async health({ user }) {
    const context=buildAiContext(user);requirePermissions(context,['ai-intelligence.use']);
    return this.provider.healthCheck();
  }
  async chat({ user, request }) {
    const context=buildAiContext(user);requirePermissions(context,['ai-intelligence.use']);
    const conversationId=request.conversationId || crypto.randomUUID();
    const startedAt=Date.now();
    const interactionId=await this.auditService.start({userId:context.userId,instituteId:context.instituteIds[0],sessionId:conversationId,provider:this.provider.name,model:this.provider.model});
    const collected=[];
    try {
      const response=await this.provider.respond({systemInstruction:SYSTEM_INSTRUCTION,message:request.message,context:request.context,tools:this.registry.definitions(),requestId:interactionId,executeTool:async(name,parameters)=>{const result=await this.registry.execute({name,parameters,context,interactionId});collected.push({name,result});return result;}});
      const result={conversationId,message:response.message || 'No response was generated.',sources:dedupe(collected.flatMap(entry=>entry.result.sources || [])),toolsUsed:collected.map(entry=>entry.name),warnings:collected.flatMap(entry=>entry.result.warnings || []),coverage:Object.assign({},...collected.map(entry=>entry.result.coverage || {})),suggestedActions:[]};
      await this.auditService.finish(interactionId,'COMPLETED',{provider:this.provider.name,tool_count:collected.length,source_count:result.sources.length,duration_ms:Date.now()-startedAt});
      return result;
    } catch(error){await this.auditService.finish(interactionId,'FAILED',{provider:this.provider.name,error_code:error.code || 'AI_ERROR',tool_count:collected.length,duration_ms:Date.now()-startedAt});throw error;}
  }
}
function dedupe(rows){const seen=new Set();return rows.filter(row=>{const key=`${row.type}:${row.id}`;if(seen.has(key))return false;seen.add(key);return true;});}
module.exports={AiService};