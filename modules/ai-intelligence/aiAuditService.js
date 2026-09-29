'use strict';

const pool = require('../../config/db');

class AiAuditService {
  constructor(database = pool) { this.database = database; }
  async start({ userId, instituteId, sessionId, provider, model }) {
    const result = await this.database.query(
      `INSERT INTO ai_interactions(user_id,institute_id,session_id,feature,provider,model,status,started_at)
       VALUES($1,$2,$3,'chat',$4,$5,'STARTED',NOW()) RETURNING id`,
      [userId,instituteId,sessionId,provider || null,model || null]
    );
    return result.rows[0].id;
  }
  async finish(id, status, metadata = {}) {
    await this.database.query(
      `UPDATE ai_interactions SET status=$2, completed_at=NOW(), metadata=$3::jsonb WHERE id=$1`,
      [id,status,JSON.stringify(metadata)]
    );
  }
  async tool({ interactionId, toolName, parameters, resultMetadata, recordCount, elapsedMs, success, errorCode }) {
    await this.database.query(
      `INSERT INTO ai_tool_executions(interaction_id,tool_name,parameters,result_metadata,record_count,execution_time_ms,success,error_code)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)`,
      [interactionId,toolName,JSON.stringify(parameters || {}),JSON.stringify(resultMetadata || {}),recordCount ?? null,elapsedMs,success,errorCode || null]
    );
  }
}

module.exports = { AiAuditService };