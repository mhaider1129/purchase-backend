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