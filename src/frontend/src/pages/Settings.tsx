import React, { useState, useEffect, useCallback, useRef } from 'react';

type Provider = 'OpenAI' | 'Anthropic' | 'Local';
interface SettingsData {
  provider: Provider;
  apiKey: string;
  model: string;
  mcpUrl: string;
  theme: 'dark' | 'light' | 'system';
  language: string;
}

const STORAGE_KEY = 'audiobiblica-settings';

const DEFAULTS: SettingsData = {
  provider: 'OpenAI',
  apiKey: '',
  model: 'gpt-4o',
  mcpUrl: 'http://localhost:8765',
  theme: 'dark',
  language: 'en',
};

const PROVIDER_MODELS: Record<Provider, string[]> = {
  OpenAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  Anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  Local: ['llama3.1', 'mistral', 'qwen2.5', 'phi4'],
};

function getSaved(): SettingsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsData>;
      return { ...DEFAULTS, ...parsed };
    }
  } catch {}
  return { ...DEFAULTS };
}

/* Lightweight toast */
const Toast: React.FC<{ message: string; onClose: () => void; type?: 'success' | 'error' | 'info' }> = ({ message, onClose, type = 'success' }) => {
  const bg = type === 'success' ? 'bg-emerald-500/90' : type === 'error' ? 'bg-rose-500/90' : 'bg-amber-500/90';
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed top-6 right-6 z-[60] ${bg} text-white px-5 py-3 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-3 text-sm font-medium animate-in slide-in-from-top-2 fade-in duration-300`}>
      <span>{type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
      <span>{message}</span>
      <button onClick={onClose} aria-label="close" className="ml-2 hover:text-white/80">×</button>
    </div>
  );
};

const Settings: React.FC = () => {
  const [data, setData] = useState<SettingsData>(getSaved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [mcpStatus, setMcpStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [mcpMsg, setMcpMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate theme on load
  useEffect(() => {
    const saved = getSaved();
    setData(saved);
  }, []);

  // Apply theme when changed
  useEffect(() => {
    if (data.theme === 'dark') document.documentElement.classList.remove('light', 'system-light');
    else if (data.theme === 'light') { document.documentElement.classList.add('light'); document.documentElement.classList.remove('system-light'); }
    else { document.documentElement.classList.add('system-light'); document.documentElement.classList.remove('light'); }
  }, [data.theme]);

  const updateField = (key: keyof SettingsData, value: any) => {
    setData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
  }, []);

  const save = () => {
    const e: Record<string, string> = {};
    if (!data.provider) e.provider = 'Select a provider';
    if (!data.apiKey && data.provider !== 'Local') e.apiKey = 'API key required';
    if (!data.model) e.model = 'Select a model';
    if (!data.mcpUrl || !/^https?:\/\/.+/.test(data.mcpUrl)) e.mcpUrl = 'Valid server URL required';
    setErrors(e);
    if (Object.keys(e).length > 0) {
      showToast('Please fix validation errors.', 'error');
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      showToast('Settings saved successfully.', 'success');
    } catch {
      showToast('Failed to save settings.', 'error');
    }
  };

  const fetchMcp = async () => {
    setMcpStatus('checking');
    setMcpMsg('');
    try {
      // Use relative /mcp endpoint against current origin (backend at :8000 if proxied, else try direct)
      const url = new URL(data.mcpUrl);
      // Try with a short timeout; in real setup this hits localhost:8765 or gateway
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${data.mcpUrl}/status`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        setMcpStatus('connected');
        setMcpMsg('MCP server is responsive.');
        showToast('MCP connection verified.', 'success');
      } else {
        setMcpStatus('error');
        setMcpMsg('MCP server returned non-OK status.');
      }
    } catch {
      setMcpStatus('error');
      setMcpMsg('Could not connect to MCP server (timeout or unreachable).');
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Only PDF files are accepted.', 'error');
      setFileName('');
      return;
    }
    setFileName(file.name);
    setProcessing(true);
    setProcessingProgress(0);
    // Simulate processing
    const int = setInterval(() => {
      setProcessingProgress((p) => {
        if (p >= 100) {
          clearInterval(int);
          setProcessing(false);
          setProcessingProgress(100);
          showToast('Equipment import complete.', 'success');
          return 100;
        }
        return p + 10;
      });
    }, 300);
  };

  const statusColor = mcpStatus === 'connected' ? 'text-emerald-400' : mcpStatus === 'checking' ? 'text-amber-400' : mcpStatus === 'error' ? 'text-rose-400' : 'text-slate-400';
  const statusLabel = mcpStatus === 'connected' ? 'Connected' : mcpStatus === 'checking' ? 'Checking…' : mcpStatus === 'error' ? 'Disconnected' : 'Unknown';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-10">
          <h2 className="text-3xl font-extrabold tracking-tight text-amber-400 mb-2">Settings</h2>
          <p className="text-slate-400">Configure AI providers, MCP server, equipment imports, and preferences.</p>
        </div>

        {/* AI Provider */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-7 mb-6 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h3 className="text-lg font-bold text-amber-300">AI Provider</h3>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label htmlFor="provider" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Provider</label>
              <select
                id="provider"
                value={data.provider}
                onChange={(e) => { updateField('provider', e.target.value as Provider); setData((prev) => ({ ...prev, model: PROVIDER_MODELS[e.target.value as Provider][0] })); }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60 transition shadow-inner"
              >
                {Object.keys(PROVIDER_MODELS).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {errors.provider && <p className="text-rose-400 text-xs mt-1.5">{errors.provider}</p>}
            </div>

            <div>
              <label htmlFor="model" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Model</label>
              <select
                id="model"
                value={data.model}
                onChange={(e) => updateField('model', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60 transition shadow-inner"
              >
                {PROVIDER_MODELS[data.provider].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {errors.model && <p className="text-rose-400 text-xs mt-1.5">{errors.model}</p>}
            </div>
          </div>

          <div className="mt-5 relative">
            <label htmlFor="apiKey" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">API Key <span className="normal-case text-slate-500 font-normal">(masked)</span></label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={data.apiKey}
                  onChange={(e) => updateField('apiKey', e.target.value)}
                  placeholder={data.provider === 'Local' ? 'Not required for local' : 'sk-…'}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60 transition shadow-inner font-mono"
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
                aria-label="Toggle visibility"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.apiKey && <p className="text-rose-400 text-xs mt-1.5">{errors.apiKey}</p>}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={save}
              className="px-6 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-bold text-sm hover:bg-amber-300 transition shadow-lg shadow-amber-400/20 active:scale-[0.98]"
            >
              Save Provider Settings
            </button>
            <span className="text-xs text-slate-500">Saved to localStorage</span>
          </div>
        </section>

        {/* MCP */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-7 mb-6 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h3 className="text-lg font-bold text-amber-300">MCP Server</h3>
          </div>

          <div className="grid md:grid-cols-3 gap-5 items-end">
            <div className="md:col-span-2">
              <label htmlFor="mcpUrl" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Server URL</label>
              <input
                id="mcpUrl"
                type="url"
                value={data.mcpUrl}
                onChange={(e) => updateField('mcpUrl', e.target.value)}
                className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition shadow-inner font-mono ${errors.mcpUrl ? 'border-rose-500/70 focus:ring-rose-400/60' : 'border-slate-700 focus:ring-amber-400/60'}`}
                placeholder="http://localhost:8765"
              />
              {errors.mcpUrl && <p className="text-rose-400 text-xs mt-1.5">{errors.mcpUrl}</p>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={fetchMcp}
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-sm font-semibold text-slate-200 transition"
              >
                Check
              </button>
              <div className="text-right min-w-[140px]">
                <div className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</div>
                <div className="text-[11px] text-slate-400">{mcpMsg || '—'}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Equipment Import */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-7 mb-6 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h3 className="text-lg font-bold text-amber-300">Equipment Import</h3>
          </div>

          <div className="border-2 border-dashed border-slate-700 rounded-2xl p-8 text-center hover:border-amber-400/60 transition bg-slate-950/40">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-sm font-semibold text-slate-200 transition shadow-md"
            >
              <span>📄</span> Upload PDF
            </button>
            <p className="text-xs text-slate-500 mt-3">PDF manuals and spec sheets. Max 20MB.</p>
          </div>

          {fileName && (
            <div className="mt-4 rounded-xl bg-slate-950 border border-slate-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-200 truncate max-w-[80%]">{fileName}</div>
                <div className={`text-xs font-bold ${processing ? 'text-amber-400' : 'text-emerald-400'}`}>{processing ? 'Processing' : 'Done'}</div>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-amber-300 rounded-full transition-all duration-300"
                  style={{ width: `${processingProgress}%` }}
                />
              </div>
              <div className="text-xs text-slate-400 mt-1">{processingProgress}% — extracting specs</div>
            </div>
          )}
        </section>

        {/* Preferences */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-7 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h3 className="text-lg font-bold text-amber-300">Preferences</h3>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="theme" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Theme</label>
              <select
                id="theme"
                value={data.theme}
                onChange={(e) => updateField('theme', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60 transition shadow-inner"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
            <div>
              <label htmlFor="language" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Language</label>
              <select
                id="language"
                value={data.language}
                onChange={(e) => updateField('language', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60 transition shadow-inner"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
          </div>

          <div className="mt-7 flex items-center gap-3">
            <button
              onClick={save}
              className="px-6 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-bold text-sm hover:bg-amber-300 transition shadow-lg shadow-amber-400/20 active:scale-[0.98]"
            >
              Save Preferences
            </button>
          </div>
        </section>
      </div>

      {toast && <Toast message={toast.msg} onClose={() => setToast(null)} type={toast.type} />}
    </div>
  );
};

export default Settings;
