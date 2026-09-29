'use strict';

const { AiAuditService } = require('../modules/ai-intelligence/aiAuditService');

describe('AI audit fail-closed behavior', () => {
  test.each([
    ['start', service => service.start({ userId: 1, instituteId: 2, sessionId: 's', provider: 'ollama', model: 'm' })],
    ['finish', service => service.finish(1, 'COMPLETED')],
    ['tool', service => service.tool({ interactionId: 1, toolName: 'get_pending_approvals', elapsedMs: 1, success: true })],
  ])('%s persistence failure becomes a controlled 503', async (_operation, invoke) => {
    const service = new AiAuditService({ query: jest.fn().mockRejectedValue(new Error('database unavailable')) });
    await expect(invoke(service)).rejects.toMatchObject({ statusCode: 503, code: 'AI_AUDIT_UNAVAILABLE' });
  });
});