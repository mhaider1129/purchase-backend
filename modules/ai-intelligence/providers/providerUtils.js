'use strict';

const { aiError } = require('../aiErrors');

function boundedInteger(value, fallback, { minimum, maximum, name }) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', `${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', 'OLLAMA_BASE_URL must be a valid HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw aiError(503, 'AI_PROVIDER_CONFIGURATION_ERROR', 'OLLAMA_BASE_URL must be an HTTP(S) origin without credentials, query, or fragment');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function fetchJson({ fetchImplementation, url, options, timeoutMs }) {
  if (typeof fetchImplementation !== 'function') {
    throw aiError(503, 'AI_SERVICE_UNAVAILABLE', 'AI provider HTTP client is unavailable');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw aiError(503, 'AI_SERVICE_UNAVAILABLE', 'AI provider request failed');
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw aiError(504, 'AI_PROVIDER_TIMEOUT', 'AI provider timed out');
    if (error?.statusCode) throw error;
    throw aiError(503, 'AI_SERVICE_UNAVAILABLE', 'AI provider is unavailable');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { boundedInteger, normalizeBaseUrl, fetchJson };