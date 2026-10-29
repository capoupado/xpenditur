import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { SectionCard, inputCls } from './shared.jsx';

export default function AiSettings() {
  const [providers, setProviders] = useState([]);
  const [settings, setSettings] = useState({});
  const [activeId, setActiveId] = useState(''); // saved active provider
  const [providerId, setProviderId] = useState(''); // provider being edited
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState([]);
  const [modelsError, setModelsError] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const provider = providers.find((p) => p.id === providerId) || null;
  const maskedKey = provider ? settings[`ai_key_${provider.id}`] || '' : '';

  const loadSettings = () =>
    api.get('/settings').then((data) => {
      setSettings(data);
      setActiveId(data.ai_provider || '');
      return data;
    });

  const fetchModels = async (id, { key, url } = {}) => {
    setLoadingModels(true);
    setModelsError('');
    try {
      const res = await api.post('/settings/ai-models', { provider: id, apiKey: key || undefined, baseUrl: url || undefined });
      setModels(res.models);
      if (res.models.length === 0) setModelsError('The provider returned no models — type a model id manually.');
    } catch (err) {
      setModels([]);
      setModelsError(`Could not list models (${err.message}). You can still type a model id manually.`);
    } finally {
      setLoadingModels(false);
    }
  };

  // Populate the form for a provider from saved settings, and list its models
  // straight away when it already has what it needs (a stored key or base URL).
  const selectProvider = (id, data = settings, list = providers) => {
    setProviderId(id);
    setApiKey('');
    setModel(data[`ai_model_${id}`] || '');
    setBaseUrl(data.ai_custom_base_url || '');
    setModels([]);
    setModelsError('');
    const meta = list.find((p) => p.id === id);
    if (!meta) return;
    const hasKey = !!data[`ai_key_${id}`];
    const ready = meta.needsBaseUrl ? !!data.ai_custom_base_url && (hasKey || meta.keyOptional) : hasKey;
    if (ready) fetchModels(id);
  };

  useEffect(() => {
    Promise.all([api.get('/settings/ai-providers'), loadSettings()])
      .then(([list, data]) => {
        setProviders(list);
        selectProvider(data.ai_provider || list[0]?.id || '', data, list);
      })
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyBlur = () => {
    if (!provider || !apiKey.trim()) return;
    if (provider.needsBaseUrl && !baseUrl.trim()) return;
    fetchModels(provider.id, { key: apiKey.trim(), url: baseUrl.trim() });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!provider) return;
    if (!model.trim()) {
      toast.error('Pick or type a model first');
      return;
    }
    setSaving(true);
    try {
      const payload = { ai_provider: provider.id, [`ai_model_${provider.id}`]: model.trim() };
      // Only send the key if a new one was typed (else we'd store the mask).
      if (apiKey.trim() !== '') payload[`ai_key_${provider.id}`] = apiKey.trim();
      if (provider.needsBaseUrl) payload.ai_custom_base_url = baseUrl.trim();
      await api.put('/settings', payload);
      toast.success(`${provider.label} is now the active AI provider`);
      setApiKey('');
      await loadSettings();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.post('/settings/ai-test', {});
      toast.success(`${res.provider} (${res.model}) answered`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  const activeLabel = providers.find((p) => p.id === activeId)?.label;
  const activeModel = activeId ? settings[`ai_model_${activeId}`] : '';

  return (
    <SectionCard
      title="AI provider"
      description="Used to parse PDF bank statements and suggest categories. Each provider keeps its own key and model, so you can switch freely."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <p className="text-sm text-gray-400">
          {activeLabel ? (
            <>
              Active: <span className="text-gray-200">{activeLabel}</span>
              {activeModel ? <> · <span className="font-mono text-gray-200">{activeModel}</span></> : ' · no model set'}
            </>
          ) : (
            'No AI provider configured — PDF import and AI categorization are disabled.'
          )}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Provider</label>
            <select value={providerId} onChange={(e) => selectProvider(e.target.value)} className={inputCls}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {settings[`ai_key_${p.id}`] ? ' — key saved' : ''}
                  {p.id === activeId ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </div>
          {provider && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                API key{provider.keyOptional ? ' (optional)' : ''}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleKeyBlur}
                placeholder={maskedKey || 'Paste API key'}
                className={inputCls}
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 mt-1">
                {maskedKey ? `Currently set: ${maskedKey}. Leave blank to keep it.` : 'Not configured.'}
                {provider.keyUrl && (
                  <>
                    {' '}
                    <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">
                      Get a key
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {provider?.note && <p className="text-xs text-amber-400">{provider.note}</p>}

        {provider?.needsBaseUrl && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className={inputCls}
            />
            <p className="text-xs text-gray-500 mt-1">
              Any OpenAI-compatible server (Ollama, LM Studio, vLLM…). Requests go to &lt;base URL&gt;/chat/completions.
            </p>
          </div>
        )}

        {provider && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Model</label>
            <div className="flex gap-2">
              <input
                list="ai-model-options"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={loadingModels ? 'Loading models…' : 'Pick from the list or type a model id'}
                className={`${inputCls} font-mono`}
              />
              <datalist id="ai-model-options">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => fetchModels(provider.id, { key: apiKey.trim(), url: baseUrl.trim() })}
                disabled={loadingModels}
                className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-3 py-2 transition-colors shrink-0"
              >
                {loadingModels ? 'Loading…' : 'Refresh models'}
              </button>
            </div>
            <p className={`text-xs mt-1 ${modelsError ? 'text-amber-400' : 'text-gray-500'}`}>
              {modelsError || (models.length ? `${models.length} models available from ${provider.label}.` : 'Enter a key to load the model list.')}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !activeId}
            className="rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium px-4 py-2 transition-colors"
          >
            {testing ? 'Testing…' : 'Test active provider'}
          </button>
          <button
            type="submit"
            disabled={saving || !provider}
            className="rounded-lg bg-lime-mid hover:bg-[#7aab5c] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            {saving ? 'Saving…' : 'Save & use this provider'}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
