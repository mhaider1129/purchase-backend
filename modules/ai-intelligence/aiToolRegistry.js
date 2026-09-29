
'use strict';

const { aiError } = require('./aiErrors');
const { validators } = require('./validation');
const { authorizeTool } = require('./aiPermissionService');

class AiToolRegistry {
  constructor({ tools, auditService, maxResultBytes = process.env.AI_MAX_TOOL_RESULT_BYTES || 65536 }) {
    this.tools=Object.freeze({...tools});
    this.auditService=auditService;
    this.maxResultBytes=Number(maxResultBytes);
    if (!Number.isInteger(this.maxResultBytes) || this.maxResultBytes < 1024 || this.maxResultBytes > 1048576) {
      throw aiError(503,'AI_PROVIDER_CONFIGURATION_ERROR','AI_MAX_TOOL_RESULT_BYTES must be between 1024 and 1048576');
    }
  }
  definitions() { return Object.entries(this.tools).map(([name,tool]) => ({name,description:tool.description,parameters:tool.parameters})); }
  names() { return Object.keys(this.tools); }
  async execute({ name, parameters, context, interactionId }) {
    const tool=this.tools[name];
    if (!tool) throw aiError(400,'AI_UNKNOWN_TOOL',`Unknown AI tool: ${name}`);
    authorizeTool(context,name);
    const validated=validators[name](parameters);
    const started=Date.now();
    try {
      const result=await tool.execute(validated,context);
      const resultBytes=Buffer.byteLength(JSON.stringify(result),'utf8');
      if (resultBytes > this.maxResultBytes) {
        throw aiError(413,'AI_TOOL_RESULT_TOO_LARGE','AI tool result is too large; narrow the requested filters');
      }
      await this.auditService.tool({interactionId,toolName:name,parameters:validated,resultMetadata:{coverage:result.coverage || null,warnings:(result.warnings || []).length,result_bytes:resultBytes},recordCount:result.recordCount,elapsedMs:Date.now()-started,success:true});
      return result;
    } catch (error) {
      await this.auditService.tool({interactionId,toolName:name,parameters:validated,resultMetadata:{},recordCount:null,elapsedMs:Date.now()-started,success:false,errorCode:error.code || 'AI_TOOL_ERROR'});
      throw error;
    }
  }
}

module.exports = { AiToolRegistry };