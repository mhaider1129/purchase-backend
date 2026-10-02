'use strict';

const { aiError } = require('./aiErrors');
const { OllamaProvider } = require('./providers/ollamaProvider');
const { OpenAiProvider } = require('./providers/openaiProvider');

const PROVIDERS = Object.freeze({
  ollama: options => new OllamaProvider(options),
  openai: options => new OpenAiProvider(options),
});

class InvalidProvider {
  constructor(name, configurationError = null) {
    this.name = name || 'unknown';
    this.model = null;
    this.configurationError = configurationError;
  }

  async respond() {
    if (this.configurationError) throw this.configurationError;
    throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', `Unsupported AI provider: ${this.name}`);
  }

  async healthCheck() {
    return { status: 'unavailable', provider: this.name, model: null, reason: 'AI_PROVIDER_CONFIGURATION_ERROR' };
  }

  async supportsTools() {
    return false;
  }
}

function createAiProvider(options = {}) {
  const environment = options.environment || process.env;
  const configuredProvider = options.provider || environment.AI_PROVIDER;
  // Existing deployments pre-date AI_PROVIDER and already carry OpenAI
  // credentials. Prefer that complete configuration rather than silently
  // switching those installations to a local Ollama server that is not there.
  const defaultProvider = environment.OPENAI_API_KEY && (environment.OPENAI_MODEL || environment.AI_MODEL)
    ? 'openai'
    : 'ollama';
  const name = String(configuredProvider || defaultProvider).trim().toLowerCase();
  const factory = PROVIDERS[name];
  if (!factory) return new InvalidProvider(name);
  try {
    return factory({ ...options, environment });
  } catch (error) {
    if (error?.code === 'AI_PROVIDER_CONFIGURATION_ERROR') return new InvalidProvider(name, error);
    throw error;
  }
}

module.exports = { createAiProvider, InvalidProvider, OllamaProvider, OpenAiProvider };