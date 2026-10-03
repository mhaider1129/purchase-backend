'use strict';

const { aiError } = require('../aiErrors');
const { boundedInteger, normalizeBaseUrl, fetchJson } = require('./providerUtils');
const { log } = require('../../../utils/observability');

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
    // Qwen 3 enables its (comparatively expensive) reasoning mode by default.
    // Procurement answers are grounded by our tools, so hidden chain-of-thought adds
    // latency without adding data. It can still be enabled explicitly for a deployment.
    this.think = parseBoolean(options.think ?? environment.OLLAMA_THINK, false, 'OLLAMA_THINK');
    this.keepAlive = String(options.keepAlive ?? environment.OLLAMA_KEEP_ALIVE ?? '10m').trim();
    if (!this.keepAlive || this.keepAlive.length > 32) {
      throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', 'OLLAMA_KEEP_ALIVE must be between 1 and 32 characters');
    }
    this.fetch = options.fetch || global.fetch;
    this.logger = options.logger || (metadata => log('info', metadata.event, metadata));
    this.toolsSupportPromise = null;
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
    if (this.toolsSupportPromise) return this.toolsSupportPromise;
    this.toolsSupportPromise = this.inspectToolSupport();
    try {
      return await this.toolsSupportPromise;
    } catch (error) {
      // Do not permanently cache transient startup or network failures.
      this.toolsSupportPromise = null;
      if (error.code === 'AI_PROVIDER_TIMEOUT') throw error;
      throw aiError(503, 'AI_SERVICE_UNAVAILABLE', 'Unable to inspect the configured Ollama model');
    }
  }

  async inspectToolSupport() {
    const payload = await this.request('/api/show', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.model }),
    });
    return Array.isArray(payload.capabilities) && payload.capabilities.includes('tools');
  }

  async respond({ systemInstruction, message, context = {}, tools, executeTool, requestId }) {
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
      const requestPayload = {
        model: this.model,
        messages,
        tools: ollamaTools,
        stream: false,
        think: this.think,
        keep_alive: this.keepAlive,
      };
      const body = JSON.stringify(requestPayload);
      const requestMetadata = {
        event: 'ai.ollama.iteration',
        requestId: requestId ?? null,
        iteration: iteration + 1,
        model: this.model,
        think: this.think,
        messageCount: messages.length,
        toolCount: ollamaTools.length,
        requestPayloadBytes: byteLength(body),
        messagesBytes: serializedBytes(messages),
        toolSchemaBytes: serializedBytes(ollamaTools),
        toolResultBytes: messages
          .filter(entry => entry?.role === 'tool')
          .reduce((total, entry) => total + byteLength(entry.content), 0),
      };
      const requestStarted = Date.now();
      let payload;
      try {
        payload = await this.request('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        });
      } catch (error) {
        this.logDiagnostic({
          ...requestMetadata,
          ollamaRequestElapsedMs: Date.now() - requestStarted,
          success: false,
          errorCode: error?.code || 'AI_SERVICE_UNAVAILABLE',
        });
        throw error;
      }
      const assistant = payload?.message;
      const calls = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls : [];
      this.logDiagnostic({
        ...requestMetadata,
        ollamaRequestElapsedMs: Date.now() - requestStarted,
        success: true,
        ...ollamaTimingMetadata(payload),
        toolCallCount: calls.length,
      });
      if (!assistant || typeof assistant !== 'object') {
        throw aiError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'Ollama returned an invalid chat response');
      }
      messages.push(assistant);
      if (!calls.length) return { message: assistant.content || 'No response was generated.', model: this.model };

      for (const call of calls) {
        const name = call?.function?.name;
        const parameters = normalizeArguments(call?.function?.arguments);
        const toolStarted = Date.now();
        let result;
        try {
          result = await executeToolSafely(executeTool, name, parameters);
        } catch (error) {
          this.logDiagnostic({ event: 'ai.tool.execution', requestId: requestId ?? null,
            iteration: iteration + 1, toolName: name || null, executionElapsedMs: Date.now() - toolStarted,
            resultBytes: null, success: false, retryableValidationError: false,
            errorCode: error?.code || 'AI_TOOL_ERROR' });
          throw error;
        }
        const serializedResult = JSON.stringify(result);
        const retryableValidationError = result?.error?.code === 'AI_INVALID_PARAMETERS'
          && result?.error?.retryable === true;
        this.logDiagnostic({ event: 'ai.tool.execution', requestId: requestId ?? null,
          iteration: iteration + 1, toolName: name || null, executionElapsedMs: Date.now() - toolStarted,
          resultBytes: byteLength(serializedResult), success: !retryableValidationError,
          retryableValidationError });
        messages.push({ role: 'tool', tool_name: name, content: serializedResult });
      }
    }
    throw aiError(502, 'AI_PROVIDER_TOOL_LIMIT', `AI provider exceeded ${this.maxToolIterations} tool iterations`);
  }

  request(path, options) {
    return fetchJson({ fetchImplementation: this.fetch, url: `${this.baseUrl}${path}`, options, timeoutMs: this.timeoutMs });
  }

  logDiagnostic(metadata) {
    try {
      if (typeof this.logger === 'function') this.logger(metadata);
      else if (typeof this.logger?.info === 'function') this.logger.info(metadata);
    } catch (_error) {
      // Diagnostics must never alter provider behavior.
    }
  }
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : '', 'utf8');
}

function serializedBytes(value) {
  return byteLength(JSON.stringify(value));
}

function nanosecondsToMilliseconds(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value / 1e6 : undefined;
}

function ollamaTimingMetadata(payload) {
  return Object.fromEntries(Object.entries({
    totalDurationMs: nanosecondsToMilliseconds(payload?.total_duration),
    loadDurationMs: nanosecondsToMilliseconds(payload?.load_duration),
    promptEvalCount: Number.isFinite(payload?.prompt_eval_count) ? payload.prompt_eval_count : undefined,
    promptEvalDurationMs: nanosecondsToMilliseconds(payload?.prompt_eval_duration),
    evalCount: Number.isFinite(payload?.eval_count) ? payload.eval_count : undefined,
    evalDurationMs: nanosecondsToMilliseconds(payload?.eval_duration),
    doneReason: typeof payload?.done_reason === 'string' ? payload.done_reason : undefined,
  }).filter(([, value]) => value !== undefined));
}

function parseBoolean(value, fallback, name) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', `${name} must be true or false`);
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