import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantConfig, clearAssistantCredential, createBackup, DataStatus, getApiBaseUrl, getAssistantConfig, getDataStatus, getMcpStatus, getSetupStatus, importCatalog, listAssistantModels, pullModel, restoreBackup, saveAssistantConfig, testAssistantConnection } from '../lib/api';
import { Icon } from '../components/Icon';
import SetupDoctor, { SettingsSection } from '../components/SetupDoctor';
import { Button, InlineNotice, PageHeader, StatusDot } from '../components/ui';

type Provider = AssistantConfig['provider'];
type Runtime = AssistantConfig['runtime'];

interface SettingsData {
  runtime: Runtime;
  provider: Provider;
  apiKey: string;
  model: string;
  localBaseUrl: string;
  nanobotUrl: string;
  nanobotApiKey: string;
  firecrawlApiKey: string;
}

const STORAGE_KEY = 'audiobiblica-settings';

const DEFAULTS: SettingsData = {
  runtime: 'builtin',
  provider: 'Local',
  apiKey: '',
  model: 'llama3.2:3b',
  localBaseUrl: 'http://localhost:11434',
  nanobotUrl: 'http://localhost:8900',
  nanobotApiKey: '',
  firecrawlApiKey: '',
};

const PROVIDER_MODELS: Record<Provider, string[]> = {
  OpenAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  Anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'],
  Local: ['llama3.2:3b', 'llama3.2:latest', 'mistral', 'qwen2.5', 'phi4'],
};

function getSaved(): SettingsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsData> & { mcpUrl?: string; theme?: string };
      const { mcpUrl: _obsoleteMcpUrl, theme: _obsoleteTheme, ...settings } = parsed;
      return { ...DEFAULTS, ...settings };
    }
  } catch {}
  return { ...DEFAULTS };
}

/* A Firecrawl key can only be probed once it is active, so put the previously
   stored key back (or clear the rejected one) whenever a test fails. */
async function restoreFirecrawlKey(previousKey: string): Promise<boolean> {
  const url = `${getApiBaseUrl()}/api/v1/config/firecrawl`;
  try {
    if (previousKey) {
      const restored = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: previousKey }),
      });
      if (restored.ok) return true;
    }
    await fetch(url, { method: 'DELETE' });
  } catch {}
  return false;
}

/* Lightweight toast */
const Toast: React.FC<{ message: string; onClose: () => void; type?: 'success' | 'error' }> = ({ message, onClose, type = 'success' }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  const isError = type === 'error';
  return (
    <div className={`toast ${isError ? 'toast--danger' : 'toast--success'}`} role={isError ? 'alert' : 'status'}>
      <span aria-hidden="true">{isError ? '✗' : '✓'}</span>
      <span>{message}</span>
      <button type="button" className="toast__dismiss" onClick={onClose} aria-label="Dismiss notification">×</button>
    </div>
  );
};

const Settings: React.FC = () => {
  const [data, setData] = useState<SettingsData>(getSaved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [mcpStatus, setMcpStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [mcpMsg, setMcpMsg] = useState('');
  const [assistantStatus, setAssistantStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [assistantMsg, setAssistantMsg] = useState('');
  const [assistantKeyConfigured, setAssistantKeyConfigured] = useState(false);
  const [nanobotKeyConfigured, setNanobotKeyConfigured] = useState(false);
  const [firecrawlConfigured, setFirecrawlConfigured] = useState(false);
  const [firecrawlStatus, setFirecrawlStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [firecrawlMsg, setFirecrawlMsg] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showNanobotKey, setShowNanobotKey] = useState(false);
  const [showFirecrawlKey, setShowFirecrawlKey] = useState(false);
  const savedFirecrawlKey = useRef('');
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState('');

  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMsg, setDataMsg] = useState('');

  const refreshDataStatus = useCallback(async () => {
    try {
      setDataStatus(await getDataStatus());
    } catch {
      setDataStatus(null);
    }
  }, []);

  const [modelStatus, setModelStatus] = useState<{ available: boolean; reachable: boolean; pulling: boolean }>({ available: false, reachable: false, pulling: false });

  const refreshModelStatus = useCallback(async () => {
    try {
      const status = await getSetupStatus();
      setModelStatus({
        available: status.assistant.model_available,
        reachable: status.assistant.reachable,
        pulling: status.assistant.pulling === 'pulling',
      });
    } catch {
      setModelStatus({ available: false, reachable: false, pulling: false });
    }
  }, []);

  useEffect(() => {
    if (!modelStatus.pulling) return;
    const timer = window.setInterval(() => { void refreshModelStatus(); }, 5000);
    return () => window.clearInterval(timer);
  }, [modelStatus.pulling, refreshModelStatus]);

  useEffect(() => {
    setData(getSaved());
    void getAssistantConfig().then((settings) => {
      setAssistantKeyConfigured(settings.api_key_configured);
      setNanobotKeyConfigured(settings.nanobot_api_key_configured);
      setData((current) => ({
        ...current,
        runtime: settings.runtime,
        provider: settings.provider,
        model: settings.model,
        localBaseUrl: settings.local_base_url,
        nanobotUrl: settings.nanobot_url,
      }));
    }).catch(() => undefined);
    void fetch(`${getApiBaseUrl()}/api/v1/config/firecrawl`).then(async (response) => {
      if (!response.ok) return;
      const settings = await response.json();
      setFirecrawlConfigured(Boolean(settings.api_key_configured));
    }).catch(() => undefined);
    void refreshModelStatus();
    void refreshDataStatus();
  }, [refreshModelStatus, refreshDataStatus]);

  useEffect(() => {
    let active = true;
    setModelsError('');
    void listAssistantModels()
      .then((result) => { if (active) setLiveModels(result.models); })
      .catch((caught) => {
        if (!active) return;
        setLiveModels([]);
        setModelsError(caught instanceof Error ? caught.message : 'Could not list models from the assistant service.');
      });
    return () => { active = false; };
  }, [data.runtime, data.provider, data.localBaseUrl]);

  const updateField = (key: keyof SettingsData, value: any) => {
    setData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
  }, []);

  const downloadModel = async () => {
    const model = data.model || 'llama3.2:3b';
    try {
      await pullModel(model);
      await refreshModelStatus();
      showToast(`Downloading ${model}. This can take a few minutes.`);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The download could not start.', 'error');
    }
  };

  const exportCatalog = async () => {
    setDataBusy(true);
    setDataMsg('');
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/data/export`);
      if (!response.ok) throw new Error(`The export failed (HTTP ${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `audiobiblica-export-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      showToast('Your catalog was exported.');
    } catch (caught) {
      setDataMsg(caught instanceof Error ? caught.message : 'The export failed.');
    } finally {
      setDataBusy(false);
    }
  };

  const importCatalogFile = async (file: File) => {
    setDataBusy(true);
    setDataMsg('');
    try {
      const counts = await importCatalog(file);
      await refreshDataStatus();
      setDataMsg(`Imported ${counts.equipment_added} new device(s), updated ${counts.equipment_updated}, added ${counts.manuals_added} manual(s) and ${counts.findings_added} research finding(s); ${counts.skipped} already present.`);
    } catch (caught) {
      setDataMsg(caught instanceof Error ? caught.message : 'That file could not be imported.');
    } finally {
      setDataBusy(false);
    }
  };

  /* One restore path for the whole app: the backups list and the health report's
     "restore" fix both land here, so the confirmation is worded once. The reload
     is deliberate — everything on screen was read from the catalog being replaced. */
  const restoreSnapshot = async (name: string) => {
    if (!window.confirm(`Replace your current catalog with the copy from ${name}? A safety copy of the current catalog is taken first.`)) return;
    setDataBusy(true);
    setDataMsg('');
    try {
      const result = await restoreBackup(name);
      setDataMsg(`Restored ${result.restored}. Reloading…`);
      window.location.reload();
    } catch (caught) {
      setDataMsg(caught instanceof Error ? caught.message : 'That backup could not be restored.');
      setDataBusy(false);
    }
  };

  const backupNow = async () => {
    setDataBusy(true);
    setDataMsg('');
    try {
      const result = await createBackup();
      await refreshDataStatus();
      setDataMsg(result.backup ? `Copied your catalog to ${result.backup.name}.` : 'There is nothing to copy yet.');
    } catch (caught) {
      setDataMsg(caught instanceof Error ? caught.message : 'The copy could not be taken.');
    } finally {
      setDataBusy(false);
    }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (data.provider !== 'Local' && data.apiKey && data.apiKey.length < 10) e.apiKey = 'API key appears invalid';
    if (data.nanobotApiKey && data.nanobotApiKey.length < 10) e.nanobotApiKey = 'API key appears invalid';
    if (data.runtime === 'builtin' && !data.model.trim()) e.model = 'Choose a model';
    if (data.runtime === 'nanobot' && !/^https?:\/\/.+/.test(data.nanobotUrl)) e.nanobotUrl = 'Valid Nanobot URL required';
    if (data.runtime === 'builtin' && data.provider === 'Local' && !/^https?:\/\/.+/.test(data.localBaseUrl)) e.localBaseUrl = 'Valid Ollama URL required';
    setErrors(e);
    if (Object.keys(e).length > 0) {
      showToast('Please fix validation errors.', 'error');
      return;
    }
    try {
      const tasks: Promise<unknown>[] = [
        saveAssistantConfig({
          runtime: data.runtime,
          provider: data.provider,
          model: data.runtime === 'nanobot' ? data.model.trim() || 'nanobot' : data.model.trim(),
          local_base_url: data.localBaseUrl.trim(),
          nanobot_url: data.nanobotUrl.trim(),
          ...(data.apiKey.trim() ? { api_key: data.apiKey.trim() } : {}),
          ...(data.nanobotApiKey.trim() ? { nanobot_api_key: data.nanobotApiKey.trim() } : {}),
        }),
      ];
      if (data.firecrawlApiKey.trim()) tasks.push(fetch(`${getApiBaseUrl()}/api/v1/config/firecrawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: data.firecrawlApiKey.trim() }),
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Could not save Firecrawl configuration (HTTP ${response.status}).`);
      }));
      const [assistantConfig] = await Promise.all(tasks) as [AssistantConfig];
      setAssistantKeyConfigured(assistantConfig.api_key_configured);
      setNanobotKeyConfigured(assistantConfig.nanobot_api_key_configured);
      if (data.firecrawlApiKey.trim()) {
        savedFirecrawlKey.current = data.firecrawlApiKey.trim();
        setFirecrawlConfigured(true);
      }
      const { apiKey: _apiKey, nanobotApiKey: _nanobotApiKey, firecrawlApiKey: _firecrawlApiKey, ...safeSettings } = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeSettings));
      setData((current) => ({ ...current, apiKey: '', nanobotApiKey: '', firecrawlApiKey: '' }));
      showToast('Settings saved successfully.', 'success');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Failed to save settings.', 'error');
    }
  };

  const fetchMcp = async () => {
    setMcpStatus('checking');
    setMcpMsg('');
    try {
      const result = await getMcpStatus();
      if (result.mcp?.status !== 'ready') throw new Error('AudioBiblica MCP server is not ready.');
      setMcpStatus('connected');
      setMcpMsg('Streamable HTTP MCP endpoint is ready.');
    } catch (caught) {
      setMcpStatus('error');
      setMcpMsg(caught instanceof Error ? caught.message : 'Could not reach the AudioBiblica MCP server.');
    }
  };

  const testAssistant = async () => {
    setAssistantStatus('checking');
    setAssistantMsg('');
    try {
      const result = await testAssistantConnection();
      setAssistantStatus('connected');
      setAssistantMsg(result.message);
    } catch (caught) {
      setAssistantStatus('error');
      setAssistantMsg(caught instanceof Error ? caught.message : 'Could not reach the selected assistant.');
    }
  };

  const clearCredential = async (runtime: Runtime) => {
    try {
      await clearAssistantCredential(runtime);
      if (runtime === 'builtin') {
        setAssistantKeyConfigured(false);
        updateField('apiKey', '');
      } else {
        setNanobotKeyConfigured(false);
        updateField('nanobotApiKey', '');
      }
      showToast('Saved API key removed.', 'success');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not remove the saved API key.', 'error');
    }
  };

  const clearFirecrawl = async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/config/firecrawl`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Could not remove Firecrawl configuration (HTTP ${response.status}).`);
      setFirecrawlConfigured(false);
      updateField('firecrawlApiKey', '');
      showToast('Saved Firecrawl key removed.', 'success');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not remove the Firecrawl API key.', 'error');
    }
  };

  const fetchFirecrawl = async () => {
    setFirecrawlStatus('checking');
    setFirecrawlMsg('');
    const candidateKey = data.firecrawlApiKey.trim();
    if (!candidateKey && !firecrawlConfigured) {
      setFirecrawlStatus('error');
      setFirecrawlMsg('Firecrawl API key not configured.');
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let candidatePersisted = false;
    try {
      if (candidateKey) {
        const configResponse = await fetch(`${getApiBaseUrl()}/api/v1/config/firecrawl`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: candidateKey }),
          signal: controller.signal,
        });
        if (!configResponse.ok) throw new Error(`Could not save Firecrawl configuration (HTTP ${configResponse.status}).`);
        candidatePersisted = true;
      }
      const response = await fetch(`${getApiBaseUrl()}/api/v1/research/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test', limit: 1 }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) throw new Error(result.detail || result.error || 'Firecrawl API returned an error.');
      if (candidatePersisted) setFirecrawlConfigured(true);
      setFirecrawlStatus('connected');
      setFirecrawlMsg('Firecrawl returned a successful one-result search.');
    } catch (caught) {
      if (candidatePersisted) setFirecrawlConfigured(await restoreFirecrawlKey(savedFirecrawlKey.current));
      setFirecrawlStatus('error');
      setFirecrawlMsg(caught instanceof Error ? caught.message : 'Could not connect to Firecrawl API.');
    } finally {
      clearTimeout(timeout);
    }
  };

  const statusColor = mcpStatus === 'connected' ? 'success' : mcpStatus === 'checking' ? 'warning' : mcpStatus === 'error' ? 'danger' : 'neutral';
  const statusLabel = mcpStatus === 'connected' ? 'Connected' : mcpStatus === 'checking' ? 'Checking…' : mcpStatus === 'error' ? 'Disconnected' : 'Unknown';
  const providerModels = liveModels.length > 0 ? liveModels : PROVIDER_MODELS[data.provider];
  const modelOptions = !data.model || providerModels.includes(data.model) ? providerModels : [data.model, ...providerModels];
  const sections = [
    { id: 'assistant', label: 'Assistant', icon: 'sparkles' as const },
    { id: 'web-search', label: 'Web search (optional)', icon: 'globe' as const },
    { id: 'advanced', label: 'Advanced', icon: 'server' as const },
    { id: 'your-data', label: 'Your data', icon: 'database' as const },
    { id: 'doctor', label: 'Check my setup', icon: 'activity' as const },
  ] as const;

  const [activeSection, setActiveSection] = useState<SettingsSection>(sections[0].id);

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Settings" description="Choose how the assistant answers, add an optional web search key, and reach the service addresses." actions={<Button variant="primary" icon="check" onClick={save}>Save all</Button>} />
      {toast && <Toast message={toast.msg} onClose={() => setToast(null)} type={toast.type} />}
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">{sections.map((section) => <button key={section.id} className={activeSection === section.id ? 'active' : ''} onClick={() => setActiveSection(section.id)}><Icon name={section.icon} size={15} />{section.label}</button>)}</nav>
        <div className="settings-content">
          {activeSection === 'assistant' && <section className="settings-section" aria-labelledby="ai-heading">
            <div className="settings-section-header"><div><h2 id="ai-heading">Assistant runtime</h2><p>Choose the built-in provider adapter or the OpenAI-compatible Nanobot agent gateway.</p></div></div>
            <div className="form-grid">
              <div className="form-field"><label htmlFor="assistant-runtime">Runtime</label><select id="assistant-runtime" value={data.runtime} onChange={(event) => updateField('runtime', event.target.value as Runtime)}><option value="builtin">Built-in provider</option><option value="nanobot">Nanobot gateway</option></select></div>
              {data.runtime === 'builtin' && <div className="form-field"><label htmlFor="provider">Provider</label><select id="provider" value={data.provider} onChange={(event) => updateField('provider', event.target.value as Provider)}><option value="OpenAI">OpenAI</option><option value="Anthropic">Anthropic</option><option value="Local">Local (Ollama)</option></select></div>}
              <div className="form-field"><label htmlFor="model">Model</label>{data.runtime === 'builtin' ? <select id="model" value={data.model} onChange={(event) => updateField('model', event.target.value)}>{modelOptions.map((model) => <option key={model} value={model}>{liveModels.length > 0 && !liveModels.includes(model) ? `${model} (not available)` : model}</option>)}</select> : <input id="model" value={data.model} onChange={(event) => updateField('model', event.target.value)} placeholder="Nanobot selects its configured model" />}{data.runtime === 'builtin' && modelsError && <span className="field-help" style={{ color: 'var(--amber)' }}>{modelsError} Showing suggested {data.provider} models instead.</span>}</div>
              {data.runtime === 'builtin' && data.provider === 'Local' && (
                <div className="form-field form-field-wide">
                  <span>Model on this computer</span>
                  {modelStatus.available ? (
                    <StatusDot tone="success" label="Installed and ready" />
                  ) : modelStatus.pulling ? (
                    <span className="field-help">Downloading… this can take a few minutes.</span>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" icon="upload" onClick={() => void downloadModel()}>Download {data.model || 'llama3.2:3b'} (about 2 GB)</Button>
                      {!modelStatus.reachable && <span className="field-help">Ollama is not running. Install or start it from ollama.com/download.</span>}
                    </>
                  )}
                </div>
              )}
              {data.runtime === 'builtin' && data.provider !== 'Local' && <div className="form-field form-field-wide secret-field"><label htmlFor="assistant-api-key">{data.provider} API key</label><input id="assistant-api-key" autoComplete="new-password" type={showKey ? 'text' : 'password'} value={data.apiKey} onChange={(event) => updateField('apiKey', event.target.value)} placeholder={assistantKeyConfigured ? 'Saved securely; enter a replacement or leave blank' : 'Enter API key'} /><button type="button" className="secret-toggle" onClick={() => setShowKey((visible) => !visible)}>{showKey ? 'Hide' : 'Show'}</button>{assistantKeyConfigured && <span className="field-help">A key is stored in the backend config on this machine.</span>}{errors.apiKey && <span className="field-help" style={{ color: 'var(--red)' }}>{errors.apiKey}</span>}</div>}
            </div>
            <div className="form-actions"><Button variant="secondary" icon="plug" onClick={() => void testAssistant()} disabled={assistantStatus === 'checking'}>{assistantStatus === 'checking' ? 'Testing…' : 'Test saved assistant'}</Button><StatusDot tone={assistantStatus === 'connected' ? 'success' : assistantStatus === 'error' ? 'danger' : assistantStatus === 'checking' ? 'warning' : 'neutral'} label={assistantStatus === 'connected' ? 'Connected' : assistantStatus === 'error' ? 'Unavailable' : assistantStatus === 'checking' ? 'Testing' : 'Not tested'} />{data.runtime === 'builtin' && assistantKeyConfigured && <Button variant="ghost" size="sm" onClick={() => void clearCredential('builtin')}>Remove saved provider key</Button>}{data.runtime === 'nanobot' && nanobotKeyConfigured && <Button variant="ghost" size="sm" onClick={() => void clearCredential('nanobot')}>Remove saved Nanobot key</Button>}</div>
            {assistantMsg && <InlineNotice tone={assistantStatus === 'connected' ? 'success' : 'danger'} icon={assistantStatus === 'connected' ? 'check' : 'x'}>{assistantMsg}</InlineNotice>}
            <p className="field-help">Save changes before testing. Provider credentials are kept in the backend config file, never browser storage. Local models require Ollama to be running.</p>
          </section>}
          {activeSection === 'web-search' && <section className="settings-section" id="web-search" aria-labelledby="web-search-heading">
            <div className="settings-section-header"><div><h2 id="web-search-heading">Web search (optional)</h2><p>Your own Firecrawl key adds live web search and structured extraction. Nothing else in AudioBiblica needs it.</p></div></div>
            <div className="form-grid"><div className="form-field form-field-wide secret-field"><label htmlFor="firecrawlApiKey">Firecrawl API key</label><input id="firecrawlApiKey" autoComplete="new-password" type={showFirecrawlKey ? 'text' : 'password'} value={data.firecrawlApiKey} onChange={(event) => updateField('firecrawlApiKey', event.target.value)} placeholder={firecrawlConfigured ? 'Saved securely; enter a replacement or leave blank' : 'fc-…'} /><button className="secret-toggle" type="button" onClick={() => setShowFirecrawlKey(!showFirecrawlKey)}>{showFirecrawlKey ? 'Hide' : 'Show'}</button>{firecrawlConfigured && <span className="field-help">A key is stored in the backend config on this machine.</span>}</div></div>
            <div className="form-actions"><Button variant="secondary" icon="plug" onClick={() => void fetchFirecrawl()} disabled={firecrawlStatus === 'checking'}>{firecrawlStatus === 'checking' ? 'Testing…' : 'Test Firecrawl'}</Button><StatusDot tone={firecrawlStatus === 'connected' ? 'success' : firecrawlStatus === 'error' ? 'danger' : firecrawlStatus === 'checking' ? 'warning' : 'neutral'} label={firecrawlConfigured ? firecrawlStatus === 'connected' ? 'Connected' : firecrawlStatus === 'error' ? 'Unavailable' : firecrawlStatus === 'checking' ? 'Testing' : 'Configured' : 'Not configured'} />{firecrawlConfigured && <Button variant="ghost" size="sm" onClick={() => void clearFirecrawl()}>Remove saved key</Button>}</div>
            {firecrawlMsg && <InlineNotice tone={firecrawlStatus === 'connected' ? 'success' : 'danger'} icon={firecrawlStatus === 'connected' ? 'check' : 'x'}>{firecrawlMsg}</InlineNotice>}
            <p className="field-help">Testing sends one live search request to Firecrawl.</p>
          </section>}
          {activeSection === 'advanced' && <section className="settings-section" aria-labelledby="advanced-heading">
            <div className="settings-section-header"><div><h2 id="advanced-heading">Advanced</h2><p>Service addresses and the MCP endpoint. Change these only if you moved something.</p></div></div>
            <div className="form-grid">
              {data.runtime === 'builtin' && data.provider === 'Local' && <div className="form-field form-field-wide"><label htmlFor="local-base-url">Ollama URL</label><input id="local-base-url" type="url" value={data.localBaseUrl} onChange={(event) => updateField('localBaseUrl', event.target.value)} placeholder="http://localhost:11434" />{errors.localBaseUrl && <span className="field-help" style={{ color: 'var(--red)' }}>{errors.localBaseUrl}</span>}</div>}
              {data.runtime === 'nanobot' && <>
                <div className="form-field form-field-wide"><label htmlFor="nanobot-url">Nanobot API URL</label><input id="nanobot-url" type="url" value={data.nanobotUrl} onChange={(event) => updateField('nanobotUrl', event.target.value)} placeholder="http://localhost:8900" />{errors.nanobotUrl && <span className="field-help" style={{ color: 'var(--red)' }}>{errors.nanobotUrl}</span>}</div>
                <div className="form-field form-field-wide secret-field"><label htmlFor="nanobot-api-key">Nanobot API key (only if configured)</label><input id="nanobot-api-key" autoComplete="new-password" type={showNanobotKey ? 'text' : 'password'} value={data.nanobotApiKey} onChange={(event) => updateField('nanobotApiKey', event.target.value)} placeholder={nanobotKeyConfigured ? 'Saved securely; enter a replacement or leave blank' : 'Optional for a loopback Nanobot service'} /><button type="button" className="secret-toggle" onClick={() => setShowNanobotKey((visible) => !visible)}>{showNanobotKey ? 'Hide' : 'Show'}</button>{errors.nanobotApiKey && <span className="field-help" style={{ color: 'var(--red)' }}>{errors.nanobotApiKey}</span>}</div>
              </>}
            </div>
            <div className="form-field"><span>MCP endpoint</span><code>{getApiBaseUrl()}/mcp/</code></div>
            <div className="form-actions"><Button variant="secondary" icon="server" onClick={() => void fetchMcp()} disabled={mcpStatus === 'checking'}>{mcpStatus === 'checking' ? 'Checking…' : 'Check backend'}</Button><StatusDot tone={statusColor} label={statusLabel} /></div>
            {mcpMsg && <InlineNotice tone={mcpStatus === 'connected' ? 'success' : 'danger'} icon={mcpStatus === 'connected' ? 'check' : 'x'}>{mcpMsg}</InlineNotice>}
          </section>}
          {activeSection === 'your-data' && <section className="settings-section" aria-labelledby="data-heading">
            <div className="settings-section-header"><div><h2 id="data-heading">Your data</h2><p>Everything stays on this computer.</p></div></div>
            <div className="form-field form-field-wide">
              <label htmlFor="data-dir">Catalog folder</label>
              <code id="data-dir" style={{ overflowWrap: 'anywhere' }}>{dataStatus?.data_dir || 'Reading…'}</code>
              <div className="form-actions">
                <Button size="sm" variant="ghost" icon="copy" disabled={!dataStatus} onClick={() => { void navigator.clipboard.writeText(dataStatus?.data_dir || ''); showToast('Folder path copied.'); }}>Copy path</Button>
                <Button size="sm" variant="ghost" icon="refresh" onClick={() => void refreshDataStatus()}>Refresh</Button>
              </div>
            </div>
            <div className="form-actions" style={{ marginBlockStart: 14 }}>
              <Button variant="primary" icon="download" disabled={dataBusy} onClick={() => void exportCatalog()}>Export my catalog</Button>
              <label className="button button-secondary button-md" style={{ cursor: 'pointer' }}>
                <Icon name="upload" size={17} />Import from a file
                <input type="file" accept=".zip,application/zip" className="sr-only" disabled={dataBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCatalogFile(file); event.target.value = ''; }} />
              </label>
            </div>
            {/* Every one of these messages is either a completed action or a
                sentence from the API, so the leading verb decides the tone. */}
            {dataMsg && <InlineNotice tone={/^(Imported|Copied|Restored)/.test(dataMsg) ? 'success' : 'danger'} icon={/^(Imported|Copied|Restored)/.test(dataMsg) ? 'check' : 'x'}>{dataMsg}</InlineNotice>}
            {dataStatus?.catalog_recovery && <InlineNotice tone="warning" icon="refresh">
              {dataStatus.catalog_recovery.action === 'restored'
                ? `Your catalog could not be read, so AudioBiblica restored the copy from ${new Date(dataStatus.catalog_recovery.at).toLocaleString()}. The damaged file was kept at ${dataStatus.catalog_recovery.broken_file}.`
                : `Your catalog could not be read and no usable backup was found, so AudioBiblica started with an empty one. The damaged file was kept at ${dataStatus.catalog_recovery.broken_file}.`}
            </InlineNotice>}
            <h3 style={{ fontSize: '.78rem', marginBlockStart: 20 }}>Automatic backups</h3>
            {dataStatus && dataStatus.backups.length > 0 ? (
              <ul className="backup-list">
                {dataStatus.backups.slice(0, 5).map((backup) => (
                  <li key={backup.name}>
                    <span>{new Date(backup.created_at).toLocaleString()}</span>
                    <code>{backup.name}</code>
                    <span>{Math.round(backup.size_bytes / 1024)} KB</span>
                    <Button size="sm" variant="ghost" icon="refresh" disabled={dataBusy} onClick={() => void restoreSnapshot(backup.name)}>Restore</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-help">A copy is saved here every time AudioBiblica starts, so there is always something to go back to.</p>
            )}
            <div className="form-actions" style={{ marginBlockStart: 14 }}>
              <Button size="sm" variant="secondary" icon="package" disabled={dataBusy} onClick={() => void backupNow()}>Back up now</Button>
            </div>
          </section>}
          {activeSection === 'doctor' && (
            <SetupDoctor onRestore={restoreSnapshot} onOpenSection={setActiveSection} onToast={showToast} />
          )}
        </div>
      </div>
    </>
  );
};

export default Settings;