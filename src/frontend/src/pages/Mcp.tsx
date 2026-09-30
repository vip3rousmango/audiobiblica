import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { callMcpTool, getApiBaseUrl, getHealth, getMcpStatus, listMcpTools, McpTool } from '../lib/api';
import { Icon } from '../components/Icon';
import { Button, InlineNotice, PageHeader, StatusDot, Surface } from '../components/ui';

type ConnectionState = 'checking' | 'connected' | 'offline';

function defaultArguments(tool?: McpTool): string {
  const schema = tool?.inputSchema as {
    required?: string[];
    properties?: Record<string, { type?: string }>;
  } | undefined;
  const args: Record<string, unknown> = {};
  for (const name of schema?.required ?? []) {
    const type = schema?.properties?.[name]?.type;
    args[name] = type === 'array' ? [] : type === 'object' ? {} : type === 'boolean' ? false : type === 'number' || type === 'integer' ? 0 : '';
  }
  return JSON.stringify(args, null, 2);
}

const Mcp: React.FC = () => {
  const [health, setHealth] = useState<ConnectionState>('checking');
  const [mcp, setMcp] = useState<ConnectionState>('checking');
  const [tools, setTools] = useState<McpTool[]>([]);
  const [selectedTool, setSelectedTool] = useState('');
  const [argument, setArgument] = useState('{}');
  const [output, setOutput] = useState('');
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'danger'; message: string } | null>(null);

  const checkServices = useCallback(async () => {
    setHealth('checking');
    setMcp('checking');
    const [healthResult, mcpResult, toolsResult] = await Promise.allSettled([getHealth(), getMcpStatus(), listMcpTools()]);
    const availableTools = toolsResult.status === 'fulfilled' ? toolsResult.value : [];
    setTools(availableTools);
    setHealth(healthResult.status === 'fulfilled' && healthResult.value.status === 'ok' ? 'connected' : 'offline');
    setMcp(mcpResult.status === 'fulfilled' && mcpResult.value.mcp?.status === 'ready' && toolsResult.status === 'fulfilled' ? 'connected' : 'offline');
    setSelectedTool(current => availableTools.some(tool => tool.name === current) ? current : availableTools[0]?.name || '');
    setArgument(current => current === '{}' && availableTools.length ? defaultArguments(availableTools[0]) : current);
  }, []);

  useEffect(() => { void checkServices(); }, [checkServices]);

  const testTool = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTool) return;
    setTesting(true);
    setNotice(null);
    setOutput('');
    try {
      const args = JSON.parse(argument) as Record<string, unknown>;
      if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Arguments must be a JSON object.');
      const result = await callMcpTool(selectedTool, args);
      setOutput(JSON.stringify(result, null, 2));
      setNotice({ tone: 'success', message: 'Tool completed over the Streamable HTTP MCP protocol.' });
      setMcp('connected');
    } catch (caught) {
      setNotice({ tone: 'danger', message: caught instanceof Error ? caught.message : 'Tool request failed.' });
      setMcp('offline');
    } finally {
      setTesting(false);
    }
  };

  const statusLabel = (state: ConnectionState) => state === 'connected' ? 'Connected' : state === 'offline' ? 'Offline' : 'Checking…';
  const statusTone = (state: ConnectionState) => state === 'connected' ? 'success' : state === 'offline' ? 'danger' : 'neutral';

  return (
    <>
      <PageHeader eyebrow="Agent infrastructure" title="MCP control room" description="Inspect the standard MCP endpoint and call AudioBiblica tools using Streamable HTTP." actions={<Button variant="secondary" icon="refresh" onClick={() => void checkServices()}>Refresh status</Button>} />
      {notice && <InlineNotice tone={notice.tone} icon={notice.tone === 'success' ? 'check' : notice.tone === 'danger' ? 'x' : 'activity'}>{notice.message}</InlineNotice>}

      <div className="mcp-grid" style={{ marginBlockStart: notice ? 16 : 0 }}>
        <Surface>
          <div className="surface-header"><div className="surface-title"><Icon name="server" size={17} /><div><h2>Connection health</h2><p>Local services available to this workspace.</p></div></div><StatusDot tone={statusTone(mcp)} label={statusLabel(mcp)} /></div>
          <div className="surface-body" style={{ display: 'grid', gap: 9 }}>
            <div className="endpoint-card"><div className="endpoint-main"><span className="endpoint-icon"><Icon name="server" size={16} /></span><div><strong>FastAPI backend</strong><span>{getApiBaseUrl()}</span></div></div><StatusDot tone={statusTone(health)} label={statusLabel(health)} /></div>
            <div className="endpoint-card"><div className="endpoint-main"><span className="endpoint-icon"><Icon name="plug" size={16} /></span><div><strong>Streamable HTTP MCP</strong><span>{getApiBaseUrl()}/mcp/</span></div></div><StatusDot tone={statusTone(mcp)} label={statusLabel(mcp)} /></div>
            <p className="field-help">Configure this endpoint in Nanobot's MCP Apps settings. The API key for the model is configured in Nanobot itself.</p>
          </div>
        </Surface>

        <Surface>
          <div className="surface-header"><div className="surface-title"><Icon name="layers" size={17} /><div><h2>Exposed tools</h2><p>Loaded from the standard MCP tools/list method.</p></div></div><span className="tag tag-acid">{tools.length} tools</span></div>
          <div className="surface-body tool-list">{tools.map((tool) => <div className="tool-card" key={tool.name}><strong>{tool.name}</strong><p>{tool.description}</p></div>)}</div>
        </Surface>
      </div>

      <Surface style={{ marginBlockStart: 16 } as React.CSSProperties}>
        <div className="surface-header"><div className="surface-title"><Icon name="activity" size={17} /><div><h2>Send a test request</h2><p>Exercise the actual MCP initialize and tools/call exchange.</p></div></div></div>
        <div className="surface-body tool-test">
          <form className="form-grid" onSubmit={(event) => void testTool(event)}>
            <div className="form-field"><label htmlFor="mcp-tool">Tool</label><select id="mcp-tool" value={selectedTool} onChange={(event) => { const selected = tools.find((tool) => tool.name === event.target.value); setSelectedTool(event.target.value); setArgument(defaultArguments(selected)); }} aria-describedby="mcp-tool-description" disabled={!tools.length}><option value="" disabled>Select an available tool…</option>{tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select><span className="field-help" id="mcp-tool-description">{tools.find((tool) => tool.name === selectedTool)?.description}</span></div>
            <div className="form-field form-field-wide"><label htmlFor="mcp-arguments">Tool arguments (JSON object)</label><textarea id="mcp-arguments" value={argument} onChange={(event) => setArgument(event.target.value)} rows={5} spellCheck={false} /></div>
            <div className="form-field form-field-wide"><div className="form-actions" style={{ marginBlockStart: 0 }}><Button type="submit" variant="primary" icon="send" disabled={testing}>{testing ? 'Calling tool…' : 'Call MCP tool'}</Button></div></div>
          </form>
          {output && <pre className="tool-output" aria-label="Tool response">{output}</pre>}
        </div>
      </Surface>
    </>
  );
};

export default Mcp;
