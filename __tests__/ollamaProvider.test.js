'use strict';

const express = require('express');
const request = require('supertest');
const { createAiProvider, OllamaProvider } = require('../modules/ai-intelligence/aiProviderService');
const { createAiRouter } = require('../modules/ai-intelligence/routes');

const jsonResponse = (payload, ok = true) => ({ ok, json: jest.fn().mockResolvedValue(payload) });
const tool = { name: 'get_request_summary', description: 'Read a request', parameters: { type: 'object', properties: { requestId: { type: 'integer' } } } };

describe('provider selection', () => {
  test('Ollama is the default and does not require an OpenAI key', () => {
    const provider = createAiProvider({ environment: {} });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
    expect(provider.model).toBe('qwen3:4b');
  });

  test('existing OpenAI configuration is selected when AI_PROVIDER is unset', () => {
    const provider = createAiProvider({ environment: { OPENAI_API_KEY: 'secret', OPENAI_MODEL: 'gpt-4.1-mini' } });
    expect(provider.name).toBe('openai');
    expect(provider.model).toBe('gpt-4.1-mini');
  });

  test('explicit provider takes precedence over auto-detection', () => {
    const provider = createAiProvider({ environment: {
      AI_PROVIDER: 'ollama', OPENAI_API_KEY: 'secret', OPENAI_MODEL: 'gpt-4.1-mini', OLLAMA_MODEL: 'qwen3:8b',
    } });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.model).toBe('qwen3:8b');
  });

  test('generic AI_MODEL remains compatible with explicitly selected providers', () => {
    expect(createAiProvider({ environment: { AI_PROVIDER: 'ollama', AI_MODEL: 'qwen3:8b' } }).model).toBe('qwen3:8b');
    expect(createAiProvider({ environment: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'secret', AI_MODEL: 'gpt-4.1-mini' } }).model)
      .toBe('gpt-4.1-mini');
  });

  test('AI_PROVIDER=ollama selects configured Ollama', () => {
    const provider = createAiProvider({ environment: { AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'mistral:latest' } });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.model).toBe('mistral:latest');
  });

  test('unknown provider fails safely without crashing router construction', async () => {
    const provider = createAiProvider({ environment: { AI_PROVIDER: 'sql-agent' } });
    await expect(provider.respond()).rejects.toMatchObject({ code: 'AI_PROVIDER_CONFIGURATION_ERROR', statusCode: 503 });
    await expect(provider.healthCheck()).resolves.toEqual({ status: 'unavailable', provider: 'sql-agent', model: null, reason: 'AI_PROVIDER_CONFIGURATION_ERROR' });
  });

  test('invalid Ollama configuration fails safely without crashing application setup', async () => {
    const provider = createAiProvider({ environment: { AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'file:///etc/passwd' } });
    expect(provider.name).toBe('ollama');
    await expect(provider.respond()).rejects.toMatchObject({ code: 'AI_PROVIDER_CONFIGURATION_ERROR', statusCode: 503 });
  });
});

describe('Ollama HTTP provider', () => {
  test('health reports installed model without exposing base URL', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ capabilities: ['completion', 'tools'] }));
    const result = await new OllamaProvider({ fetch }).healthCheck();
    expect(result).toEqual({ status: 'available', provider: 'ollama', model: 'qwen3:4b' });
    expect(result).not.toHaveProperty('baseUrl');
  });

  test('unavailable Ollama returns controlled health and chat errors', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const provider = new OllamaProvider({ fetch });
    await expect(provider.healthCheck()).resolves.toMatchObject({ status: 'unavailable', reason: 'AI_SERVICE_UNAVAILABLE' });
    await expect(provider.respond({ systemInstruction: 'x', message: 'x', tools: [], executeTool: jest.fn() }))
      .rejects.toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', statusCode: 503 });
  });

  test('timeout is converted to AI_PROVIDER_TIMEOUT', async () => {
    const fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    await expect(new OllamaProvider({ fetch, timeoutMs: 1000 }).respond({ systemInstruction: 'x', message: 'x', tools: [], executeTool: jest.fn() }))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_TIMEOUT', statusCode: 504 });
  }, 2000);

  test('tool calls flow only through the supplied registry callback', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['completion', 'tools'] }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_request_summary', arguments: { requestId: 42 } } }] } }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: 'Request 42 is pending.' } }));
    const executeTool = jest.fn().mockResolvedValue({ data: { id: 42 }, recordCount: 1 });
    const provider = new OllamaProvider({ fetch });
    const result = await provider.respond({ systemInstruction: 'read only', message: 'status?', tools: [tool], executeTool });
    expect(executeTool).toHaveBeenCalledWith('get_request_summary', { requestId: 42 });
    expect(result.message).toBe('Request 42 is pending.');
    const chatPayload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(chatPayload.tools[0].function.name).toBe('get_request_summary');
    expect(chatPayload).not.toHaveProperty('sql');
    expect(chatPayload).not.toHaveProperty('shell');
    expect(chatPayload).toMatchObject({ think: false, keep_alive: '10m' });
  });

  test('emits safe iteration and tool diagnostics with Ollama timing metadata', async () => {
    const logger = { info: jest.fn() };
    const secretPrompt = 'show private procurement record SECRET-987654';
    const secretResult = { data: [{ notes: 'CONFIDENTIAL-TOOL-RESULT' }], recordCount: 1 };
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValueOnce(jsonResponse({
        message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_request_summary', arguments: { requestId: 42 } } }] },
        total_duration: 3_370_000_000,
        load_duration: 2_830_000_000,
        prompt_eval_count: 123,
        prompt_eval_duration: 340_000_000,
        eval_count: 8,
        eval_duration: 150_000_000,
        done_reason: 'stop',
      }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: 'Request 42 is pending.' } }));
    const executeTool = jest.fn().mockResolvedValue(secretResult);

    const result = await new OllamaProvider({ fetch, logger }).respond({
      systemInstruction: 'SYSTEM POLICY THAT MUST NOT BE LOGGED', message: secretPrompt,
      requestId: 'interaction-123', tools: [tool], executeTool,
    });

    expect(result).toEqual({ message: 'Request 42 is pending.', model: 'qwen3:4b' });
    const iteration = logger.info.mock.calls.map(([entry]) => entry)
      .find(entry => entry.event === 'ai.ollama.iteration' && entry.iteration === 1);
    expect(iteration).toMatchObject({
      requestId: 'interaction-123', iteration: 1, model: 'qwen3:4b', think: false,
      messageCount: 2, toolCount: 1, success: true, toolCallCount: 1,
      totalDurationMs: 3370, loadDurationMs: 2830, promptEvalCount: 123,
      promptEvalDurationMs: 340, evalCount: 8, evalDurationMs: 150, doneReason: 'stop',
    });
    expect(iteration.requestPayloadBytes).toBeGreaterThan(iteration.messagesBytes);
    expect(iteration.toolSchemaBytes).toBeGreaterThan(0);
    expect(iteration.toolResultBytes).toBe(0);
    const secondIteration = logger.info.mock.calls.map(([entry]) => entry)
      .find(entry => entry.event === 'ai.ollama.iteration' && entry.iteration === 2);
    expect(secondIteration.toolResultBytes).toBe(Buffer.byteLength(JSON.stringify(secretResult)));
    expect(secondIteration.ollamaRequestElapsedMs).toEqual(expect.any(Number));
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ai.tool.execution', requestId: 'interaction-123', iteration: 1,
      toolName: 'get_request_summary', executionElapsedMs: expect.any(Number),
      resultBytes: Buffer.byteLength(JSON.stringify(secretResult)), success: true,
      retryableValidationError: false,
    }));
    const diagnostics = JSON.stringify(logger.info.mock.calls);
    expect(diagnostics).not.toContain(secretPrompt);
    expect(diagnostics).not.toContain('SYSTEM POLICY THAT MUST NOT BE LOGGED');
    expect(diagnostics).not.toContain('CONFIDENTIAL-TOOL-RESULT');
  });

  test('logs retryable validation result metadata without changing correction behavior', async () => {
    const logger = jest.fn();
    const invalid = Object.assign(new Error('private invalid argument details'), { code: 'AI_INVALID_PARAMETERS' });
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', tool_calls: [{ function: { name: 'get_attention_items', arguments: { buyerId: 0 } } }] } }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: 'Corrected.' } }));

    await expect(new OllamaProvider({ fetch, logger }).respond({
      systemInstruction: 'x', message: 'x', tools: [], executeTool: jest.fn().mockRejectedValue(invalid),
    })).resolves.toMatchObject({ message: 'Corrected.' });
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ai.tool.execution', toolName: 'get_attention_items',
      resultBytes: expect.any(Number), success: false, retryableValidationError: true,
    }));
    expect(JSON.stringify(logger.mock.calls)).not.toContain('private invalid argument details');
  });

  test('reuses the model capability check and allows reasoning to be explicitly enabled', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValue(jsonResponse({ message: { role: 'assistant', content: 'Ready.' } }));
    const provider = new OllamaProvider({ fetch, think: true, keepAlive: '20m' });

    await expect(provider.healthCheck()).resolves.toMatchObject({ status: 'available' });
    await expect(provider.respond({ systemInstruction: 'x', message: 'one', tools: [], executeTool: jest.fn() }))
      .resolves.toMatchObject({ message: 'Ready.' });
    await expect(provider.respond({ systemInstruction: 'x', message: 'two', tools: [], executeTool: jest.fn() }))
      .resolves.toMatchObject({ message: 'Ready.' });

    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/api/show'))).toHaveLength(1);
    const chatPayload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(chatPayload).toMatchObject({ think: true, keep_alive: '20m' });
  });

  test('rejects invalid latency configuration', async () => {
    const provider = createAiProvider({ environment: { AI_PROVIDER: 'ollama', OLLAMA_THINK: 'sometimes' } });
    await expect(provider.respond()).rejects.toMatchObject({ code: 'AI_PROVIDER_CONFIGURATION_ERROR', statusCode: 503 });
  });

  test('model tool call may omit optional buyerId', async () => {
    const attentionTool = { name: 'get_attention_items', description: 'Read attention items', parameters: { type: 'object', properties: { buyerId: { type: 'integer', minimum: 1 } }, additionalProperties: false } };
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_attention_items', arguments: {} } }] } }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: 'These cases need attention.' } }));
    const executeTool = jest.fn().mockResolvedValue({ data: [], recordCount: 0 });
    await new OllamaProvider({ fetch }).respond({ systemInstruction: 'read only', message: 'Show pending cases needing attention', tools: [attentionTool], executeTool });
    expect(executeTool).toHaveBeenCalledWith('get_attention_items', {});
    const schema = JSON.parse(fetch.mock.calls[1][1].body).tools[0].function.parameters;
    expect(schema.required).toBeUndefined();
  });

  test('null optional filters reach the registry unchanged for consistent normalization', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', tool_calls: [{ function: { name: 'get_attention_items', arguments: JSON.stringify({ buyerId: null, dateFrom: null }) } }] } }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: 'Done.' } }));
    const executeTool = jest.fn().mockResolvedValue({ data: [], recordCount: 0 });
    await new OllamaProvider({ fetch }).respond({ systemInstruction: 'x', message: 'x', tools: [], executeTool });
    expect(executeTool).toHaveBeenCalledWith('get_attention_items', { buyerId: null, dateFrom: null });
  });

  test('invalid model arguments are returned to the model for correction within the iteration limit', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', tool_calls: [{ function: { name: 'get_attention_items', arguments: { buyerId: 0 } } }] } }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', tool_calls: [{ function: { name: 'get_attention_items', arguments: {} } }] } }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: 'Corrected.' } }));
    const invalid = Object.assign(new Error('buyerId must be a positive integer'), { code: 'AI_INVALID_PARAMETERS', statusCode: 400 });
    const executeTool = jest.fn().mockRejectedValueOnce(invalid).mockResolvedValueOnce({ data: [], recordCount: 0 });
    const result = await new OllamaProvider({ fetch, maxToolIterations: 3 }).respond({ systemInstruction: 'x', message: 'x', tools: [], executeTool });
    expect(result.message).toBe('Corrected.');
    expect(executeTool).toHaveBeenNthCalledWith(1, 'get_attention_items', { buyerId: 0 });
    expect(executeTool).toHaveBeenNthCalledWith(2, 'get_attention_items', {});
    const correctionPayload = JSON.parse(fetch.mock.calls[2][1].body);
    expect(correctionPayload.messages.at(-1)).toMatchObject({ role: 'tool', tool_name: 'get_attention_items' });
    expect(JSON.parse(correctionPayload.messages.at(-1).content)).toMatchObject({ error: { code: 'AI_INVALID_PARAMETERS', retryable: true } });
  });

  test('unknown model-requested tool remains rejected by the registry callback', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', tool_calls: [{ function: { name: 'execute_sql', arguments: { query: 'DROP TABLE users' } } }] } }));
    const executeTool = jest.fn().mockRejectedValue(Object.assign(new Error('Unknown AI tool'), { code: 'AI_UNKNOWN_TOOL', statusCode: 400 }));
    await expect(new OllamaProvider({ fetch }).respond({ systemInstruction: 'x', message: 'x', tools: [tool], executeTool }))
      .rejects.toMatchObject({ code: 'AI_UNKNOWN_TOOL' });
    expect(executeTool).toHaveBeenCalledWith('execute_sql', { query: 'DROP TABLE users' });
  });

  test('tool iteration limit stops runaway calls', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ capabilities: ['tools'] }))
      .mockResolvedValue(jsonResponse({ message: { role: 'assistant', tool_calls: [{ function: { name: 'get_request_summary', arguments: { requestId: 1 } } }] } }));
    const executeTool = jest.fn().mockResolvedValue({ recordCount: 1 });
    await expect(new OllamaProvider({ fetch, maxToolIterations: 2 }).respond({ systemInstruction: 'x', message: 'x', tools: [tool], executeTool }))
      .rejects.toMatchObject({ code: 'AI_PROVIDER_TOOL_LIMIT' });
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  test('model without tool capability fails closed', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ capabilities: ['completion'] }));
    const provider = new OllamaProvider({ fetch });
    await expect(provider.healthCheck()).resolves.toMatchObject({ status: 'unavailable', reason: 'AI_MODEL_TOOLS_UNSUPPORTED' });
    await expect(provider.respond({ systemInstruction: 'x', message: 'x', tools: [tool], executeTool: jest.fn() }))
      .rejects.toMatchObject({ code: 'AI_MODEL_TOOLS_UNSUPPORTED' });
  });
});

describe('AI health isolation', () => {
  test('authenticated health endpoint reports availability and normal routes remain healthy', async () => {
    const app = express();
    const service = { health: jest.fn().mockResolvedValue({ status: 'unavailable', provider: 'ollama', model: 'qwen3:4b' }), chat: jest.fn() };
    app.use('/api/ai', (req, _res, next) => { req.user = { id: 1 }; next(); }, createAiRouter({ service }));
    app.get('/api/normal', (_req, res) => res.json({ status: 'ok' }));
    const health = await request(app).get('/api/ai/health');
    const normal = await request(app).get('/api/normal');
    expect(health.status).toBe(503);
    expect(health.body).toEqual({ status: 'unavailable', provider: 'ollama', model: 'qwen3:4b' });
    expect(normal.status).toBe(200);
  });
});