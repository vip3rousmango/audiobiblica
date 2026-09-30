export interface Equipment {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  model?: string | null;
  description?: string | null;
  specifications?: Record<string, unknown>;
  manuals?: Manual[];
  research_findings?: ResearchFinding[];
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Manual {
  id: string;
  equipment_id?: string;
  title: string;
  url: string;
  source?: string;
  downloaded_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchFinding {
  id: string;
  equipment_id: string;
  query: string;
  source_url: string;
  title: string;
  content: string;
  extracted_specs: Record<string, unknown>;
  confidence: number;
  status: string;
  created_at: string;
}

export interface HealthResponse {
  status: string;
}

export interface McpResponse {
  mcp?: {
    status?: string;
  };
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface AssistantConfig {
  runtime: 'builtin' | 'nanobot';
  provider: 'OpenAI' | 'Anthropic' | 'Local';
  model: string;
  local_base_url: string;
  nanobot_url: string;
  api_key_configured: boolean;
  nanobot_api_key_configured: boolean;
}

export interface SearchResultItem {
  url: string;
  title?: string;
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  error?: string;
}

export interface ManufacturerSearchResponse {
  equipment_id?: string;
  status?: string;
  query?: string;
  manufacturer: string;
  model: string;
  query_type: string;
  results: SearchResultItem[];
  findings?: ResearchFinding[];
  error?: string;
}

export interface ExtractSpecsResponse {
  manufacturer: string;
  model: string;
  data: Record<string, unknown>;
  sources: string[];
  error?: string;
}

export interface BatchScrapeResponse {
  results: SearchResultItem[];
}

export interface ResearchFindingCreate {
  query: string;
  source_url: string;
  title: string;
  content: string;
  extracted_specs: Record<string, unknown>;
  confidence: number;
  status: string;
}

export interface ResearchFindingsResponse {
  findings: ResearchFinding[];
}


export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  chars: number;
  error: string | null;
}



export interface AssistantSetupState {
  runtime: string;
  provider: string;
  model: string;
  reachable: boolean;
  model_available: boolean;
  models: string[];
  pulling: 'idle' | 'pulling' | 'done' | 'error';
  pull_model: string | null;
  pull_error: string | null;
  error: string | null;
}


export interface SetupStatus {
  data_dir: string;
  database_path: string;
  equipment_count: number;
  manual_count: number;
  assistant: AssistantSetupState;
  research: { firecrawl_configured: boolean; free_fetch: boolean };
  catalog_recovery: CatalogRecovery | null;
  /* False when the catalog could not be read at all; the counts are then zeros
     that mean "unknown", not "empty". */
  catalog_readable: boolean;
}

/* What happened to the catalog at this startup, or null when nothing was wrong.
   Set by the backend's own recovery pass: the notice clears on the next clean
   start, so it can never describe a file the user has already dealt with. */
export interface CatalogRecovery {
  action: 'restored' | 'started_empty';
  broken_file: string;
  restored_from: string | null;
  at: string;
}


export interface BackupEntry {
  name: string;
  created_at: string;
  size_bytes: number;
}


export interface DataStatus {
  data_dir: string;
  database_path: string;
  backups: BackupEntry[];
  catalog_recovery: CatalogRecovery | null;
}


export interface ImportCounts {
  equipment_added: number;
  equipment_updated: number;
  manuals_added: number;
  findings_added: number;
  skipped: number;
}




const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  status: number;
  /** The server's own wording, kept for the console. Never shown to the user. */
  technical: string;

  constructor(message: string, status = 0, technical = message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.technical = technical;
  }
}

/* The one place a technical failure becomes a sentence a musician can act on.
   Every user-visible error goes through here, so no screen has to word its own. */
export function friendlyMessage(status: number | undefined, technical: string): string {
  if (status === undefined) {
    return "Can't reach AudioBiblica. Make sure the app is running, then try again.";
  }
  if (status === 503 && /firecrawl/i.test(technical)) {
    return 'Web search needs a Firecrawl key. You can still add manuals by link or PDF.';
  }
  if (/model .* not found/i.test(technical)) {
    return "The assistant's model isn't installed yet. Open Settings and pick a model from the list.";
  }
  if (/did not answer in time|timed out/i.test(technical)) {
    return 'The assistant is still thinking. The first answer after a download can take a minute.';
  }
  if (status === 500) {
    return 'Something went wrong on our side. Your catalog is safe — try again.';
  }
  return "That didn't work. Try again, or open Settings to check your setup.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    const technical = error instanceof Error ? error.message : String(error);
    console.debug(`[audiobiblica] ${method} ${path} could not be sent: ${technical}`);
    throw new ApiError(friendlyMessage(undefined, technical), 0, technical);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string; error?: string; reference?: string };
    const technical = body.detail || body.error || `HTTP ${response.status} from ${method} ${path}`;
    /* The backend marks every unexpected failure with a short reference that also
       appears in its log, so the user can quote one thing and we can find the
       traceback. Appended rather than shown raw, and kept out of `technical`. */
    const message = friendlyMessage(response.status, technical) + (body.reference ? ` (Ref ${body.reference})` : '');
    console.debug(`[audiobiblica] ${method} ${path} -> ${response.status}: ${technical}`, body.reference ?? '');
    throw new ApiError(message, response.status, technical);
  }

  return response.json() as Promise<T>;
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export async function getMcpStatus(): Promise<McpResponse> {
  return request<McpResponse>('/api/v1/mcp/status');
}

export async function getAssistantConfig(): Promise<AssistantConfig> {
  return request<AssistantConfig>('/api/v1/config/assistant');
}

export async function saveAssistantConfig(input: Pick<AssistantConfig, 'runtime' | 'provider' | 'model' | 'local_base_url' | 'nanobot_url'> & { api_key?: string; nanobot_api_key?: string }): Promise<AssistantConfig> {
  return request<AssistantConfig>('/api/v1/config/assistant', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}


export async function getDataStatus(): Promise<DataStatus> {
  return request<DataStatus>('/api/v1/data/backups');
}


export async function importCatalog(file: File): Promise<ImportCounts> {
  const body = new FormData();
  body.append('file', file);
  return request<ImportCounts>('/api/v1/data/import', { method: 'POST', body });
}

/* Replace the catalog with one of its own snapshots. The backend snapshots what
   is live before it swaps, so this is undoable by repeating it with the copy it
   names as `safety_copy`. */
export async function restoreBackup(name: string): Promise<{ restored: string; safety_copy: string | null }> {
  return request('/api/v1/data/restore', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function createBackup(): Promise<{ backup: BackupEntry | null }> {
  return request('/api/v1/data/backup', { method: 'POST' });
}

/* One fixed action a check can offer. `kind` says which control to wire it to;
   everything else is wording the backend chose, so the interface never has to
   invent a fix for a problem it did not diagnose. */
interface DiagnosticFix {
  kind: 'restore' | 'backup_now' | 'open_settings' | 'download_model';
  label: string;
  name?: string;
  model?: string;
  section?: string;
}


export interface DiagnosticCheck {
  id: string;
  level: 'ok' | 'warn' | 'fail';
  title: string;
  detail: string;
  fix: DiagnosticFix | null;
}

export interface Diagnostics {
  app_version: string;
  python: string;
  platform: string;
  data_dir: string;
  database_path: string;
  database_state: string;
  catalog_recovery: CatalogRecovery | null;
  /* null when the catalog could not be read: unknown, never zero. */
  counts: { equipment: number | null; manuals: number | null; findings: number | null };
  backups: BackupEntry[];
  assistant: {
    runtime: string;
    provider: string;
    model: string;
    reachable: boolean;
    model_available: boolean;
    error: string | null;
  };
  research: { firecrawl_configured: boolean; free_fetch: boolean };
  checks: DiagnosticCheck[];
  recent_errors: string[];
}

export async function getDiagnostics(): Promise<Diagnostics> {
  return request<Diagnostics>('/api/v1/diagnostics');
}

export async function clearAssistantCredential(runtime: 'builtin' | 'nanobot'): Promise<void> {
  await request(`/api/v1/config/assistant/credentials/${runtime}`, { method: 'DELETE' });
}

export async function listAssistantModels(): Promise<{ models: string[]; provider: string; runtime: string }> {
  return request<{ models: string[]; provider: string; runtime: string }>('/api/v1/assistant/models');
}

export async function testAssistantConnection(): Promise<{ status: string; message: string }> {
  return request('/api/v1/assistant/test', { method: 'POST' });
}

export async function sendAssistantChat(input: {
  runtime: 'builtin' | 'nanobot';
  messages: { role: 'user' | 'assistant'; content: string }[];
  session_id: string;
}): Promise<{ answer: string }> {
  return request('/api/v1/assistant/chat', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return request<SetupStatus>('/api/v1/setup/status');
}

export async function pullModel(model: string): Promise<{ status: string; model: string }> {
  return request('/api/v1/setup/pull-model', { method: 'POST', body: JSON.stringify({ model }) });
}

export async function listEquipment(): Promise<Equipment[]> {
  const payload = await request<{ equipment?: Equipment[] }>('/api/v1/equipment');
  return payload.equipment ?? [];
}

export async function createEquipment(input: Omit<Equipment, 'id' | 'manuals'>): Promise<Equipment> {
  const payload = await request<{ equipment: Equipment }>('/api/v1/equipment', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return payload.equipment;
}

export async function updateEquipment(equipmentId: string, input: Partial<Equipment>): Promise<Equipment> {
  const payload = await request<{ equipment: Equipment }>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return payload.equipment;
}

export async function deleteEquipment(equipmentId: string): Promise<void> {
  await request<void>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}`, {
    method: 'DELETE',
  });
}

export async function addManual(equipmentId: string, input: Omit<Manual, 'id' | 'equipment_id' | 'downloaded_at'>): Promise<Manual> {
  const payload = await request<{ manual: Manual }>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}/manuals`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return payload.manual;
}

export async function uploadManualPdf(equipmentId: string, file: File): Promise<{ manual: Manual; extracted_specifications: Record<string, string>; characters_extracted: number }> {
  const body = new FormData();
  body.append('file', file);
  return request(`/api/v1/equipment/${encodeURIComponent(equipmentId)}/manuals/upload`, {
    method: 'POST',
    body,
  });
}

export async function deleteManual(equipmentId: string, manualId: string): Promise<void> {
  await request<void>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}/manuals/${encodeURIComponent(manualId)}`, {
    method: 'DELETE',
  });
}

export async function startResearch(
  equipmentId: string,
  queryType: 'manual' | 'specs' | 'product' | 'legacy' = 'manual'
): Promise<ManufacturerSearchResponse> {
  return request<ManufacturerSearchResponse>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}/research`, {
    method: 'POST',
    body: JSON.stringify({ query_type: queryType }),
  });
}

// --- Firecrawl Research API ---

export async function researchSearch(query: string, options?: {
  limit?: number;
  include_domains?: string[];
  exclude_domains?: string[];
}): Promise<SearchResponse> {
  return request<SearchResponse>('/api/v1/research/search', {
    method: 'POST',
    body: JSON.stringify({ query, ...options }),
  });
}

export async function researchManufacturer(
  manufacturer: string,
  model: string,
  queryType: 'manual' | 'specs' | 'product' | 'legacy' = 'manual'
): Promise<ManufacturerSearchResponse> {
  return request<ManufacturerSearchResponse>('/api/v1/research/manufacturer', {
    method: 'POST',
    body: JSON.stringify({ manufacturer, model, query_type: queryType }),
  });
}

export async function researchExtractSpecs(
  manufacturer: string,
  model: string,
  urls: string[]
): Promise<ExtractSpecsResponse> {
  return request<ExtractSpecsResponse>('/api/v1/research/extract', {
    method: 'POST',
    body: JSON.stringify({ manufacturer, model, urls }),
  });
}

export async function researchBatchScrape(urls: string[]): Promise<BatchScrapeResponse> {
  return request<BatchScrapeResponse>('/api/v1/research/batch-scrape', {
    method: 'POST',
    body: JSON.stringify({ urls }),
  });
}

// --- Research Findings (linked to equipment) ---


/* The built-in page reader: no API key, no third-party service. */
export async function fetchUrl(url: string): Promise<FetchedPage> {
  return request<FetchedPage>('/api/v1/research/fetch-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function getResearchFindings(equipmentId: string): Promise<ResearchFinding[]> {
  const payload = await request<ResearchFindingsResponse>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}/research-findings`);
  return payload.findings ?? [];
}

export async function addResearchFinding(equipmentId: string, finding: ResearchFindingCreate): Promise<ResearchFinding> {
  const payload = await request<{ finding: ResearchFinding }>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}/research-findings`, {
    method: 'POST',
    body: JSON.stringify(finding),
  });
  return payload.finding;
}

export async function deleteResearchFinding(equipmentId: string, findingId: string): Promise<void> {
  await request<void>(`/api/v1/equipment/${encodeURIComponent(equipmentId)}/research-findings/${encodeURIComponent(findingId)}`, {
    method: 'DELETE',
  });
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

async function callMcpMethod(method: string, params: Record<string, unknown>): Promise<any> {
  const endpoint = `${API_BASE_URL}/mcp/`;
  let requestId = 1;
  let protocolVersion = '2025-03-26';

  const post = async (body: Record<string, unknown>, hasResponse = true): Promise<any> => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': protocolVersion,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError('AudioBiblica MCP endpoint is unavailable.');
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new ApiError(`MCP request failed with HTTP ${response.status}: ${detail.slice(0, 300)}`, response.status);
    }
    if (!hasResponse) {
      await response.text();
      return undefined;
    }
    const envelope = await response.json();
    if (envelope.error) throw new ApiError(envelope.error.message || 'MCP request failed.');
    return envelope.result;
  };

  const initialized = await post({
    jsonrpc: '2.0',
    id: requestId++,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'AudioBiblica Control Room', version: '1.0.0' },
    },
  });
  protocolVersion = initialized.protocolVersion || protocolVersion;
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  return post({ jsonrpc: '2.0', id: requestId, method, params });
}

export async function listMcpTools(): Promise<McpTool[]> {
  const result = await callMcpMethod('tools/list', {});
  return Array.isArray(result?.tools) ? result.tools : [];
}

export async function callMcpTool(name: string, arguments_: Record<string, unknown> = {}): Promise<unknown> {
  const result = await callMcpMethod('tools/call', { name, arguments: arguments_ });
  if (result?.isError) {
    const message = Array.isArray(result.content)
      ? result.content.filter((item: { type?: string }) => item.type === 'text').map((item: { text?: string }) => item.text).filter(Boolean).join('\n')
      : '';
    throw new ApiError(message || `${name} returned an MCP tool error.`);
  }
  return result;
}