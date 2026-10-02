'use strict';

const { aiError } = require('../aiErrors');
const { boundedInteger, normalizeBaseUrl, fetchJson } = require('./providerUtils');

class OllamaProvider {
  constructor(options = {}) {
    const environment = options.environment || process.env;
    this.name = 'ollama';
    this.model = options.model || environment.OLLAMA_MODEL || environment.AI_MODEL || 'qwen3:4b';
    this.baseUrl = normalizeBaseUrl(options.baseUrl || environment.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    this.timeoutMs = boundedInteger(options.timeoutMs ?? environment.AI_TIMEOUT_MS, 60000, {
      minimum: 1000, maximum: 300000, name: 'AI_TIMEOUT_MS',
    });
    this.maxToolIterations = boundedInteger(options.maxToolIterations ?? environment.AI_MAX_TOOL_ITERATIONS, 6, {
      minimum: 1, maximum: 20, name: 'AI_MAX_TOOL_ITERATIONS',
    });
    this.fetch = options.fetch || global.fetch;
  }

  async healthCheck() {
    try {
      const toolsSupported = await this.supportsTools();
      return {
        status: toolsSupported ? 'available' : 'unavailable', provider: this.name, model: this.model,
        ...(!toolsSupported && { reason: 'AI_MODEL_TOOLS_UNSUPPORTED' }),
      };
    } catch (error) {
      return { status: 'unavailable', provider: this.name, model: this.model, reason: error.code || 'AI_SERVICE_UNAVAILABLE' };
    }
  }

  async supportsTools() {
    try {
      const payload = await this.request('/api/show', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.model }),
      });
      return Array.isArray(payload.capabilities) && payload.capabilities.includes('tools');
    } catch (error) {
      if (error.code === 'AI_PROVIDER_TIMEOUT') throw error;
      throw aiError(503, 'AI_SERVICE_UNAVAILABLE', 'Unable to inspect the configured Ollama model');
    }
  }

  async respond({ systemInstruction, message, context = {}, tools, executeTool }) {
    if (!this.model) throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', 'OLLAMA_MODEL is required');
    if (!(await this.supportsTools())) {
      throw aiError(503, 'AI_MODEL_TOOLS_UNSUPPORTED', 'The configured Ollama model does not advertise tool support');
    }

    const contextEnvelope = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
    const messages = [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: JSON.stringify({ message, page_context: contextEnvelope }) },
    ];
    const ollamaTools = tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));

    for (let iteration = 0; iteration < this.maxToolIterations; iteration += 1) {
      const payload = await this.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, tools: ollamaTools, stream: false }),
      });
      const assistant = payload?.message;
      if (!assistant || typeof assistant !== 'object') {
        throw aiError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'Ollama returned an invalid chat response');
      }
      messages.push(assistant);
      const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      if (!calls.length) return { message: assistant.content || 'No response was generated.', model: this.model };

      for (const call of calls) {
        const name = call?.function?.name;
        const parameters = normalizeArguments(call?.function?.arguments);
        const result = await executeToolSafely(executeTool, name, parameters);
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result) });
      }
    }
    throw aiError(502, 'AI_PROVIDER_TOOL_LIMIT', `AI provider exceeded ${this.maxToolIterations} tool iterations`);
  }

  request(path, options) {
    return fetchJson({ fetchImplementation: this.fetch, url: `${this.baseUrl}${path}`, options, timeoutMs: this.timeoutMs });
  }
}

async function executeToolSafely(executeTool, name, parameters) {
  try {
    return await executeTool(name, parameters);
  } catch (error) {
    if (error?.code !== 'AI_INVALID_PARAMETERS') throw error;
    return { error: { code: error.code, message: error.message, retryable: true,
      instruction: 'Correct the arguments and call the tool again. Omit optional arguments that the user did not specify.' } };
  }
}

function normalizeArguments(value) {
  if (value == null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_error) {
      // The registry must receive an object; malformed provider output is rejected here.
    }
  }
  throw aiError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'Ollama returned malformed tool arguments');
}

module.exports = { OllamaProvider, normalizeArguments };