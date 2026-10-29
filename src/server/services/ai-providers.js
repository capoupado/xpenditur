// Registry of supported AI providers (invoice extraction, PDF statement
// parsing, pending-row categorization). Pure data — imported by both
// settings-store.js (to generate per-provider settings keys) and ai-client.js
// (to make the calls), so it must not import either.
//
// `protocol` is the wire format used for chat calls:
//   'chat'     OpenAI-compatible POST {baseUrl}/chat/completions
//   'messages' Anthropic Messages API POST {baseUrl}/messages
//   'auto'     gateway serving models over different formats (OpenCode routes
//              Claude models via /messages and GPT models via /responses);
//              ai-client.js guesses from the model id and falls back.
// Every provider lists models at GET {baseUrl}/models.

export const AI_PROVIDERS = [
  { id: 'opencode', label: 'OpenCode Zen', baseUrl: 'https://opencode.ai/zen/v1', protocol: 'auto', keyUrl: 'https://opencode.ai/auth' },
  { id: 'opencode-go', label: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1', protocol: 'auto', keyUrl: 'https://opencode.ai/auth' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'chat', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', protocol: 'messages', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'chat', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', protocol: 'chat', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'chat', keyUrl: 'https://console.groq.com/keys' },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', protocol: 'chat', keyUrl: 'https://console.x.ai' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'chat', keyUrl: 'https://openrouter.ai/keys' },
  // Any OpenAI-compatible server (Ollama, LM Studio, vLLM, a local mock).
  // Base URL comes from the ai_custom_base_url setting; the key is optional.
  { id: 'custom', label: 'Custom (OpenAI-compatible)', baseUrl: '', protocol: 'chat', keyOptional: true },
];

export const AI_PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id);

export function getProvider(id) {
  return AI_PROVIDERS.find((p) => p.id === id) || null;
}
