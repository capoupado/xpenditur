// Provider-agnostic AI chat client. Every AI feature (email invoice
// extraction, PDF statement parsing, pending-row categorization) sends one
// system prompt + one user message and expects a JSON object back as text;
// this module hides which provider/wire format answers it.
//
// The active provider, its model and its API key live in settings (see
// settings-store.js → ai_provider / ai_model_<id> / ai_key_<id>), so switching
// provider keeps each provider's key and model for switching back.

import { getSetting } from './settings-store.js';
import { getProvider } from './ai-providers.js';

const REQUEST_TIMEOUT_MS = 180_000; // PDF statements can take a while
const MODELS_TIMEOUT_MS = 20_000;
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 8192;

// Ids returned by /models that can't do text chat (embeddings, audio, images…).
const NON_CHAT_MODEL_RE = /embed|tts|whisper|dall-e|imagen|moderation|transcribe|realtime|audio|image|aqa|rerank|veo|lyria/i;

// For 'auto' providers: which protocol worked for a given model, so only the
// first call per model pays for a fallback.
const protocolCache = new Map();

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function aiError(message, status) {
  const err = new Error(message);
  if (status) err.status = status;
  return err;
}

/**
 * Resolves the active AI configuration from settings, or null when it isn't
 * usable yet (no provider, no model, missing key/base URL). Callers treat null
 * as "AI not configured".
 */
export function getAiConfig() {
  const provider = getProvider(getSetting('ai_provider'));
  if (!provider) return null;
  const apiKey = getSetting(`ai_key_${provider.id}`) || '';
  const model = getSetting(`ai_model_${provider.id}`) || '';
  const baseUrl = trimSlash(provider.id === 'custom' ? getSetting('ai_custom_base_url') : provider.baseUrl);
  if (!model || !baseUrl || (!apiKey && !provider.keyOptional)) return null;
  return { provider, apiKey, model, baseUrl, label: provider.label };
}

function headersFor(provider, apiKey, protocol) {
  const headers = { 'Content-Type': 'application/json' };
  if (!apiKey) return headers;
  if (protocol === 'messages') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    // Gateways speaking the Anthropic format (OpenCode) may want either header.
    if (provider.id !== 'anthropic') headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function postJson(url, headers, body, label) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const netErr = aiError(`Could not reach ${label}: ${err.cause?.message || err.message}`);
    netErr.network = true;
    throw netErr;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw aiError(`${label} responded ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`, res.status);
  }
  return res.json();
}

// ---- Wire formats ---------------------------------------------------------

async function callChatCompletions(cfg, systemPrompt, userContent, { strict = true } = {}) {
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };
  if (strict) {
    body.temperature = 0;
    body.response_format = { type: 'json_object' };
  }
  try {
    const json = await postJson(`${cfg.baseUrl}/chat/completions`, headersFor(cfg.provider, cfg.apiKey, 'chat'), body, cfg.label);
    return json?.choices?.[0]?.message?.content;
  } catch (err) {
    // Reasoning models reject temperature, and not every model supports JSON
    // mode. The prompts already demand JSON and parseExtractionResponse is
    // tolerant, so retry once without the optional knobs.
    if (strict && err.status === 400 && /temperature|response_format|json/i.test(err.message)) {
      return callChatCompletions(cfg, systemPrompt, userContent, { strict: false });
    }
    throw err;
  }
}

async function callMessages(cfg, systemPrompt, userContent) {
  const json = await postJson(
    `${cfg.baseUrl}/messages`,
    headersFor(cfg.provider, cfg.apiKey, 'messages'),
    {
      model: cfg.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    },
    cfg.label
  );
  const blocks = Array.isArray(json?.content) ? json.content : [];
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('') || undefined;
}

async function callResponses(cfg, systemPrompt, userContent) {
  const json = await postJson(
    `${cfg.baseUrl}/responses`,
    headersFor(cfg.provider, cfg.apiKey, 'responses'),
    { model: cfg.model, instructions: systemPrompt, input: userContent },
    cfg.label
  );
  if (typeof json?.output_text === 'string') return json.output_text;
  const parts = (Array.isArray(json?.output) ? json.output : [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text);
  return parts.join('') || undefined;
}

const CALLERS = { chat: callChatCompletions, messages: callMessages, responses: callResponses };

// Best first guess for gateways serving several formats; the rest are tried
// on a format-mismatch error.
function protocolOrder(model) {
  const id = model.toLowerCase();
  let first = 'chat';
  if (id.startsWith('claude-')) first = 'messages';
  else if (/^(gpt-|o\d|codex)/.test(id)) first = 'responses';
  return [first, ...['chat', 'messages', 'responses'].filter((p) => p !== first)];
}

// Network/auth/rate-limit/server errors won't be fixed by switching format.
function isFormatMismatch(err) {
  if (err.network) return false;
  return !err.status || [400, 404, 405, 415, 422].includes(err.status);
}

/**
 * Sends one system prompt + user message to the configured provider and
 * returns the assistant's raw text. Throws on transport/HTTP errors.
 */
export async function callAiChat(cfg, { systemPrompt, userContent }) {
  if (cfg.provider.protocol === 'auto') {
    const cacheKey = `${cfg.provider.id}:${cfg.model}`;
    const known = protocolCache.get(cacheKey);
    const order = known ? [known] : protocolOrder(cfg.model);
    let firstErr;
    for (const protocol of order) {
      try {
        const content = await CALLERS[protocol](cfg, systemPrompt, userContent);
        if (typeof content !== 'string') throw aiError(`${cfg.label} response had no message content`);
        protocolCache.set(cacheKey, protocol);
        return content;
      } catch (err) {
        firstErr = firstErr || err;
        if (known || !isFormatMismatch(err)) throw err;
      }
    }
    throw firstErr;
  }

  const content = await CALLERS[cfg.provider.protocol](cfg, systemPrompt, userContent);
  if (typeof content !== 'string') throw aiError(`${cfg.label} response had no message content`);
  return content;
}

/**
 * Lists chat-capable model ids for a provider. `apiKey` / `baseUrl` override
 * the stored values so the Settings page can list models before saving.
 */
export async function listModels(providerId, { apiKey, baseUrl } = {}) {
  const provider = getProvider(providerId);
  if (!provider) throw aiError(`Unknown AI provider: ${providerId}`, 400);
  const key = apiKey || getSetting(`ai_key_${provider.id}`) || '';
  const base = trimSlash(baseUrl || (provider.id === 'custom' ? getSetting('ai_custom_base_url') : provider.baseUrl));
  if (!base) throw aiError('Set a base URL first', 400);

  const headers = {};
  if (key) {
    if (provider.protocol === 'messages') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = ANTHROPIC_VERSION;
    } else {
      headers.Authorization = `Bearer ${key}`;
    }
  }
  const url = provider.id === 'anthropic' ? `${base}/models?limit=1000` : `${base}/models`;

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(MODELS_TIMEOUT_MS) });
  } catch (err) {
    throw aiError(`Could not reach ${provider.label}: ${err.cause?.message || err.message}`, 400);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw aiError(`${provider.label} responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, 400);
  }
  const json = await res.json().catch(() => null);
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : [];
  const ids = list
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name))
    .filter((id) => typeof id === 'string' && id)
    .map((id) => id.replace(/^models\//, '')) // Gemini prefixes ids
    .filter((id) => !NON_CHAT_MODEL_RE.test(id));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export default { getAiConfig, callAiChat, listModels };
