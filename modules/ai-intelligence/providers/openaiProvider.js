'use strict';

const { aiError } = require('../aiErrors');
const { boundedInteger, fetchJson } = require('./providerUtils');

class OpenAiProvider {
  constructor(options = {}) {
    const environment = options.environment || process.env;
    this.name = 'openai';
    this.apiKey = options.apiKey || environment.OPENAI_API_KEY || null;
    this.model = options.model || environment.OPENAI_MODEL || environment.AI_MODEL || null;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? environment.AI_TIMEOUT_MS, 60000, {
      minimum: 1000, maximum: 300000, name: 'AI_TIMEOUT_MS',
    });
    this.maxToolIterations = boundedInteger(options.maxToolIterations ?? environment.AI_MAX_TOOL_ITERATIONS, 6, {
      minimum: 1, maximum: 20, name: 'AI_MAX_TOOL_ITERATIONS',
    });
    this.fetch = options.fetch || global.fetch;
  }

  async healthCheck() {
    if (!this.apiKey || !this.model) return { status: 'unavailable', provider: this.name, model: this.model };
    return { status: 'available', provider: this.name, model: this.model };
  }

  async supportsTools() {
    return Boolean(this.apiKey && this.model);
  }

  async respond({ systemInstruction, message, context = {}, tools, executeTool }) {
    if (!this.apiKey || !this.model) {
      throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', 'OpenAI provider credentials and model are not configured');
    }
    const contextEnvelope = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
    let input = [{ role: 'user', content: JSON.stringify({ message, page_context: contextEnvelope }) }];
    for (let iteration = 0; iteration < this.maxToolIterations; iteration += 1) {
      const payload = await fetchJson({
        fetchImplementation: this.fetch,
        url: 'https://api.openai.com/v1/responses',
        timeoutMs: this.timeoutMs,
        options: {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, instructions: systemInstruction, input,
            tools: tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })) }),
        },
      });
      const calls = (payload.output || []).filter(item => item.type === 'function_call');
      if (!calls.length) return { message: payload.output_text || extractText(payload.output), model: this.model };
      input = [...input, ...(payload.output || [])];
      for (const call of calls) {
        let parameters;
        try { parameters = JSON.parse(call.arguments || '{}'); }
        catch (_error) { throw aiError(502, 'AI_PROVIDER_INVALID_RESPONSE', 'AI provider returned malformed tool parameters'); }
        const result = await executeTool(call.name, parameters);
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
      }
    }
    throw aiError(502, 'AI_PROVIDER_TOOL_LIMIT', `AI provider exceeded ${this.maxToolIterations} tool iterations`);
  }
}

function extractText(output) {
  return (output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
}

module.exports = { OpenAiProvider };