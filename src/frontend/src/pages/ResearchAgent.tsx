import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addManual, addResearchFinding, deleteResearchFinding, Equipment, fetchUrl, getResearchFindings, getSetupStatus, listEquipment, ResearchFinding, researchBatchScrape, researchExtractSpecs, researchSearch, startResearch } from '../lib/api';
import { Icon } from '../components/Icon';
import { Button, EmptyState, InlineNotice, PageHeader, StatusDot, Surface } from '../components/ui';

interface ResearchJob {
  id: string;
  type: 'search' | 'crawl' | 'extract' | 'batch-scrape' | 'page';
  query: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results?: any;
  error?: string;
  createdAt: string;
}

interface CandidatePDF {
  url: string;
  title: string;
  source: string;
  specsPreview: Record<string, any>;
  content?: string;
  findingId?: string;
}

function candidateFromFinding(finding: ResearchFinding): CandidatePDF {
  let source = finding.source_url;
  try {
    source = new URL(finding.source_url).hostname;
  } catch {
    // Keep the stored source URL visible when it is not a valid web URL.
  }
  return {
    url: finding.source_url,
    title: finding.title,
    source,
    specsPreview: finding.extracted_specs || {},
    content: finding.content,
    findingId: finding.id,
  };
}

async function persistCandidateFindings(equipmentId: string, query: string, candidates: CandidatePDF[]): Promise<ResearchFinding[]> {
  return Promise.all(candidates.map(candidate => addResearchFinding(equipmentId, {
    query,
    source_url: candidate.url,
    title: candidate.title,
    content: candidate.content || '',
    extracted_specs: candidate.specsPreview,
    confidence: 0.5,
    status: 'candidate',
  })));
}

const ResearchAgent: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState('');
  const [researchQuery, setResearchQuery] = useState('');
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [candidates, setCandidates] = useState<CandidatePDF[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'discover' | 'candidates' | 'session'>('discover');
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'danger'; message: string } | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [reading, setReading] = useState(false);
  const [firecrawlConfigured, setFirecrawlConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    const equipmentId = searchParams.get('equipment');
    listEquipment().then(setEquipment).catch(() => setNotice({ tone: 'warning', message: 'Catalog unavailable. Add equipment first.' })).finally(() => setLoading(false));
    if (equipmentId) {
      setSelectedEquipment(equipmentId);
      setActiveTab('discover');
    }
    getSetupStatus()
      .then(status => setFirecrawlConfigured(status.research.firecrawl_configured))
      .catch(() => setFirecrawlConfigured(false));
  }, [searchParams]);

  const loadCandidates = useCallback(async (equipmentId: string) => {
    const findings = await getResearchFindings(equipmentId);
    const linked = new Set((equipment.find(item => item.id === equipmentId)?.manuals || []).map(manual => manual.url));
    const unique = new Map<string, CandidatePDF>();
    for (const finding of findings) {
      if (!linked.has(finding.source_url)) unique.set(finding.source_url, candidateFromFinding(finding));
    }
    setCandidates([...unique.values()]);
  }, [equipment]);

  useEffect(() => {
    if (!selectedEquipment) {
      setCandidates([]);
      return;
    }
    let active = true;
    loadCandidates(selectedEquipment).catch(error => {
      if (active) setNotice({ tone: 'warning', message: error instanceof Error ? error.message : 'Saved research could not be loaded.' });
    });
    return () => { active = false; };
  }, [selectedEquipment, loadCandidates]);

  const addJob = (job: Omit<ResearchJob, 'id' | 'createdAt' | 'status'>) => {
    const newJob: ResearchJob = { ...job, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'pending', createdAt: new Date().toISOString() };
    setJobs(current => [newJob, ...current]);
    return newJob.id;
  };

  const updateJob = (id: string, updates: Partial<ResearchJob>) => {
    setJobs(current => current.map(j => j.id === id ? { ...j, ...updates } : j));
  };

  const runSearch = async () => {
    if (!researchQuery.trim()) return;
    setNotice(null);
    const jobId = addJob({ type: 'search', query: researchQuery });
    updateJob(jobId, { status: 'running' });
    try {
      const data = await researchSearch(researchQuery, { limit: 10 });
      if (data.error) throw new Error(data.error);
      updateJob(jobId, { status: 'completed', results: data });
      const pdfCandidates: CandidatePDF[] = data.results
        .filter(result => result.url && (result.url.toLowerCase().endsWith('.pdf') || result.title?.toLowerCase().includes('manual') || result.title?.toLowerCase().includes('spec')))
        .map(result => ({
          url: result.url,
          title: result.title || 'Untitled',
          source: candidateFromFinding({ source_url: result.url } as ResearchFinding).source,
          specsPreview: {},
          content: result.markdown || '',
        }));
      if (selectedEquipment && pdfCandidates.length) {
        await persistCandidateFindings(selectedEquipment, researchQuery, pdfCandidates);
        await loadCandidates(selectedEquipment);
      } else {
        setCandidates(current => [...pdfCandidates, ...current]);
      }
      setActiveTab('candidates');
      setNotice({
        tone: pdfCandidates.length ? 'success' : 'info',
        message: `Search returned ${data.results.length} results and ${pdfCandidates.length} candidate documents${selectedEquipment && pdfCandidates.length ? '; saved to this equipment record' : ''}.`,
      });
    } catch (e) {
      updateJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : 'Search failed' });
      setNotice({ tone: 'danger', message: e instanceof Error ? e.message : 'Search failed. Check Firecrawl configuration.' });
    }
  };

  /* The zero-key path: paste a manufacturer page and keep its text. */
  const readLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setNotice(null);
    setReading(true);
    const jobId = addJob({ type: 'page', query: url });
    updateJob(jobId, { status: 'running' });
    try {
      const page = await fetchUrl(url);
      if (page.error) {
        updateJob(jobId, { status: 'failed', error: page.error });
        setNotice({ tone: 'danger', message: page.error });
        return;
      }
      updateJob(jobId, { status: 'completed', results: { results: [{ url: page.url, title: page.title }] } });
      if (!selectedEquipment) {
        setNotice({ tone: 'info', message: `Read ${page.chars.toLocaleString()} characters. Pick a device in step 1 to keep this page in your library.` });
        return;
      }
      await addResearchFinding(selectedEquipment, {
        query: url,
        source_url: page.url,
        title: page.title || page.url,
        content: page.text,
        extracted_specs: {},
        confidence: 0.6,
        status: 'candidate',
      });
      await loadCandidates(selectedEquipment);
      setActiveTab('candidates');
      setLinkUrl('');
      setNotice({ tone: 'success', message: `Read ${page.chars.toLocaleString()} characters and saved them as a candidate document.` });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'That page could not be read.';
      updateJob(jobId, { status: 'failed', error: message });
      setNotice({ tone: 'danger', message });
    } finally {
      setReading(false);
    }
  };

  const runManufacturerResearch = async () => {
    if (!selectedEquipment) {
      setNotice({ tone: 'warning', message: 'Select equipment first.' });
      return;
    }
    const item = equipment.find(e => e.id === selectedEquipment);
    if (!item) return;
    setNotice(null);
    const jobId = addJob({ type: 'search', query: `manufacturer:${item.manufacturer} model:${item.model}` });
    updateJob(jobId, { status: 'running' });
    try {
      const result = await startResearch(selectedEquipment, 'manual');
      updateJob(jobId, { status: 'completed', results: result });
      await loadCandidates(selectedEquipment);
      setEquipment(await listEquipment());
      setActiveTab('candidates');
      setNotice({ tone: 'success', message: `Saved ${result.findings?.length ?? 0} manufacturer sources for ${item.name}.` });
    } catch (e) {
      updateJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : 'Research failed' });
      setNotice({ tone: 'danger', message: e instanceof Error ? e.message : 'Manufacturer research failed.' });
    }
  };

  const runBatchScrape = async () => {
    const urls = candidates.map(c => c.url);
    if (!urls.length) return;
    const jobId = addJob({ type: 'batch-scrape', query: `${urls.length} candidate URLs` });
    updateJob(jobId, { status: 'running' });
    try {
      const result = await researchBatchScrape(urls);
      updateJob(jobId, { status: result.results?.some((r: any) => r.error) ? 'failed' : 'completed', results: result });
      if (result.results) {
        const byUrl = new Map(result.results.map(r => [r.url, r] as const));
        setCandidates(candidates.map(c => {
          const match = byUrl.get(c.url);
          return match?.metadata ? { ...c, specsPreview: match.metadata } : c;
        }));
        setNotice({ tone: 'success', message: `Scraped ${urls.length} URLs. Specs extracted for review.` });
      }
    } catch (e) {
      updateJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : 'Batch scrape failed' });
      setNotice({ tone: 'danger', message: 'Batch scrape failed.' });
    }
  };

  const runExtractSpecs = async (candidate: CandidatePDF) => {
    const jobId = addJob({ type: 'extract', query: candidate.url });
    updateJob(jobId, { status: 'running' });
    try {
      const item = equipment.find(e => e.id === selectedEquipment);
      const manufacturer = item?.manufacturer || 'Unknown';
      const model = item?.model || 'Unknown';
      const result = await researchExtractSpecs(manufacturer, model, [candidate.url]);
      updateJob(jobId, { status: result.error ? 'failed' : 'completed', results: result, error: result.error });
      if (result.data && !result.error) {
        if (selectedEquipment) {
          const existing = (await getResearchFindings(selectedEquipment)).find(finding => finding.source_url === candidate.url);
          await addResearchFinding(selectedEquipment, {
            query: existing?.query || `${manufacturer} ${model} specifications`,
            source_url: candidate.url,
            title: candidate.title,
            content: existing?.content || candidate.content || '',
            extracted_specs: result.data,
            confidence: existing?.confidence ?? 0.5,
            status: 'completed',
          });
        }
        setCandidates(current => current.map(c => c.url === candidate.url ? { ...c, specsPreview: result.data } : c));
        setEquipment(await listEquipment());
        setNotice({ tone: 'success', message: `Extracted and saved structured specs from ${candidate.title}.` });
      }
    } catch (e) {
      updateJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : 'Extraction failed' });
      setNotice({ tone: 'danger', message: e instanceof Error ? e.message : 'Specification extraction failed.' });
    }
  };

  const linkToEquipment = async (candidate: CandidatePDF) => {
    if (!selectedEquipment) {
      setNotice({ tone: 'warning', message: 'Select equipment to link this document.' });
      return;
    }
    try {
      await addManual(selectedEquipment, {
        title: candidate.title,
        url: candidate.url,
        source: candidate.source,
      });
      setNotice({ tone: 'success', message: `Linked "${candidate.title}" to equipment record.` });
      setCandidates(current => current.filter(c => c.url !== candidate.url));
      // Refresh equipment to show new finding
      const updated = await listEquipment();
      setEquipment(updated);
    } catch (e) {
      setNotice({ tone: 'danger', message: e instanceof Error ? e.message : 'Failed to link document.' });
    }
  };

  const dismissCandidate = async (candidate: CandidatePDF) => {
    if (selectedEquipment && candidate.findingId) {
      try {
        await deleteResearchFinding(selectedEquipment, candidate.findingId);
      } catch (e) {
        setNotice({ tone: 'danger', message: e instanceof Error ? e.message : `Could not dismiss "${candidate.title}".` });
        return;
      }
    }
    setCandidates(current => current.filter(c => c.url !== candidate.url));
    setNotice({ tone: 'success', message: `Dismissed "${candidate.title}".` });
  };

  const runDeepResearch = async () => {
    if (!selectedEquipment) {
      setNotice({ tone: 'warning', message: 'Select equipment for deep research.' });
      return;
    }
    const item = equipment.find(e => e.id === selectedEquipment);
    if (!item) return;
    setNotice(null);
    const jobId = addJob({ type: 'crawl', query: `Deep research: ${item.manufacturer} ${item.model}` });
    updateJob(jobId, { status: 'running' });
    try {
      const result = await startResearch(selectedEquipment, 'legacy');
      updateJob(jobId, { status: 'completed', results: result });
      await loadCandidates(selectedEquipment);
      setEquipment(await listEquipment());
      setActiveTab('candidates');
      setNotice({ tone: 'success', message: `Saved ${result.findings?.length ?? 0} legacy sources for ${item.name}.` });
    } catch (e) {
      updateJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : 'Deep research failed' });
      setNotice({ tone: 'danger', message: e instanceof Error ? e.message : 'Deep research failed.' });
    }
  };

  const selectedItem = equipment.find(e => e.id === selectedEquipment);

  return (
    <>
      <PageHeader
        eyebrow="Research agent"
        title="Equipment research"
        description="Pick a device, find its documentation, then link what you trust into the library."
      />

      {notice && <InlineNotice tone={notice.tone} icon={notice.tone === 'success' ? 'check' : notice.tone === 'danger' ? 'x' : 'activity'}>{notice.message}</InlineNotice>}

      <div className="research-steps" style={{ marginBlockStart: notice ? 16 : 0 }} aria-label="Research workflow">
        <span className={`research-step ${selectedEquipment ? 'is-done' : 'is-active'}`}>
          <span className="research-step-index">{selectedEquipment ? '✓' : '1'}</span>
          Choose equipment
        </span>
        <span className="research-step-arrow" aria-hidden="true">→</span>
        <span className={`research-step ${!selectedEquipment ? '' : candidates.length ? 'is-done' : 'is-active'}`}>
          <span className="research-step-index">{candidates.length ? '✓' : '2'}</span>
          Find documents
        </span>
        <span className="research-step-arrow" aria-hidden="true">→</span>
        <span className={`research-step ${candidates.length ? 'is-active' : ''}`}>
          <span className="research-step-index">3</span>
          Review &amp; add manuals
        </span>
      </div>

      <div className="research-layout" style={{ marginBlockStart: 16 }}>
        <aside className="research-sidebar">
          <Surface>
            <div className="surface-header"><div className="surface-title"><Icon name="library" size={17} /><div><h2>1 · Target equipment</h2><p>The device whose documents you want.</p></div></div></div>
            <div className="surface-body">
              {loading ? <p style={{ color: 'var(--muted)' }}>Loading catalog…</p> : equipment.length === 0 ? (
                <EmptyState icon="plus" title="No equipment yet" description="Add a device to start researching." action={<Button size="sm" variant="primary" icon="plus" onClick={() => navigate('/library?new=1')}>Add equipment</Button>} />
              ) : (
                <select value={selectedEquipment} onChange={e => { setSelectedEquipment(e.target.value); setSearchParams({ equipment: e.target.value || '' }); }} className="select-control" style={{ width: '100%' }}>
                  <option value="">Select equipment…</option>
                  {equipment.map(item => <option key={item.id} value={item.id}>{item.name} · {item.manufacturer}{item.model ? ` ${item.model}` : ''}</option>)}
                </select>
              )}
              {selectedItem && (
                <div className="research-target">
                  <strong className="research-target-name">{selectedItem.name}</strong>
                  <p className="research-target-meta">{selectedItem.manufacturer}{selectedItem.model ? ` · ${selectedItem.model}` : ''}</p>
                  <p className="research-target-counts">{selectedItem.research_findings?.length ?? 0} findings · {selectedItem.manuals?.length ?? 0} {(selectedItem.manuals?.length ?? 0) === 1 ? 'manual' : 'manuals'}</p>
                </div>
              )}
            </div>
          </Surface>
        </aside>

        <div className="research-main">
          <div className="view-toggle research-tabs" role="tablist" aria-label="Research views">
            <button role="tab" aria-selected={activeTab === 'discover'} className={activeTab === 'discover' ? 'active' : ''} onClick={() => setActiveTab('discover')}>Find documents</button>
            <button role="tab" aria-selected={activeTab === 'candidates'} className={activeTab === 'candidates' ? 'active' : ''} onClick={() => setActiveTab('candidates')}>Review candidates ({candidates.length})</button>
            <button role="tab" aria-selected={activeTab === 'session'} className={activeTab === 'session' ? 'active' : ''} onClick={() => setActiveTab('session')}>This session</button>
          </div>

          {activeTab === 'discover' && (
            <Surface>
              <div className="surface-header"><div className="surface-title"><Icon name="search" size={17} /><div><h2>2 · Find documents</h2><p>Search by phrase, or let the agent read the selected manufacturer's own pages.</p></div></div></div>
              <div className="surface-body">
                <div className="form-grid">
                  <div className="form-field form-field-wide">
                    <label htmlFor="research-url">Add a document from a link</label>
                    <input id="research-url" type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://www.neumann.com/en-en/products/microphones/u-87-ai/" />
                    <span className="field-help">Paste a product page or support page. This works without any paid service.</span>
                  </div>
                </div>
                <div className="candidate-actions" style={{ marginBlockStart: 14 }}>
                  <Button variant="primary" icon="globe" onClick={readLink} disabled={!linkUrl.trim() || reading}>Read this page</Button>
                </div>

                <div style={{ marginBlockStart: 20 }}>
                  <p className="eyebrow">Web search (optional)</p>
                  {firecrawlConfigured ? (
                    <>
                      <div className="form-grid" style={{ marginBlockStart: 8 }}>
                        <div className="form-field form-field-wide">
                          <label htmlFor="research-query">Search phrase</label>
                          <input id="research-query" value={researchQuery} onChange={e => setResearchQuery(e.target.value)} placeholder="e.g. 'Pultec EQP-1A service manual', 'API 2500 compressor specifications'" />
                          <span className="field-help">Web search uses your own Firecrawl key. Everything else works without it.</span>
                        </div>
                      </div>
                      <div className="candidate-actions" style={{ marginBlockStart: 14 }}>
                        <Button variant="primary" icon="search" onClick={runSearch} disabled={!researchQuery.trim() || loading}>Search the web</Button>
                        <Button variant="secondary" icon="library" onClick={runManufacturerResearch} disabled={!selectedEquipment || loading}>Use {selectedItem ? selectedItem.manufacturer : 'manufacturer'} pages</Button>
                        <Button variant="ghost" icon="globe" onClick={runDeepResearch} disabled={!selectedEquipment || loading}>Hunt legacy &amp; archives</Button>
                      </div>
                    </>
                  ) : (
                    <details style={{ marginBlockStart: 6 }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--text-soft)', fontSize: '.72rem' }}>Set up web search</summary>
                      <p className="field-help" style={{ marginBlockStart: 8 }}>
                        Web search uses your own Firecrawl key. Everything else works without it.{' '}
                        <a href="/settings#web-search">Add a key in Settings</a>.
                      </p>
                    </details>
                  )}
                </div>
                <div style={{ marginBlockStart: 16 }}>
                  <InlineNotice tone="info" icon="sparkles">
                    {selectedEquipment
                      ? 'Results are saved to the selected device and appear under Review candidates. Nothing is attached to the library until you add it as a manual.'
                      : 'Pick equipment in step 1 to save results to a device. Without a target, results stay in this tab only.'}
                  </InlineNotice>
                </div>
              </div>
            </Surface>
          )}

          {activeTab === 'candidates' && (
            <Surface>
              <div className="surface-header"><div className="surface-title"><Icon name="file" size={17} /><div><h2>3 · Review candidates</h2><p>Add the documents you trust as manuals. Dismiss the rest.</p></div></div>
                {candidates.length > 0 && <Button variant="secondary" icon="layers" onClick={runBatchScrape} disabled={candidates.length === 0 || jobs.some(j => j.status === 'running')}>Read all pages ({candidates.length})</Button>}
              </div>
              <div className="surface-body">
                {candidates.length === 0 ? (
                  <EmptyState
                    icon="search"
                    title="No candidates yet"
                    description={selectedEquipment ? 'Run a search in step 2 to collect documents for this device.' : 'Choose equipment in step 1, then run a search in step 2.'}
                    action={<Button size="sm" variant="secondary" onClick={() => setActiveTab('discover')}>Go to step 2</Button>}
                  />
                ) : (
                  <div className="candidate-grid">
                    {candidates.map((c) => (
                      <article className="candidate-card" key={c.url}>
                        <div className="candidate-head">
                          <div style={{ minWidth: 0 }}>
                            <h3 className="candidate-title">{c.title}</h3>
                            <p className="candidate-source">{c.source}{c.findingId ? '' : ' · not saved'}</p>
                          </div>
                          {Object.keys(c.specsPreview).length > 0 && <span className="tag tag-acid">{Object.keys(c.specsPreview).length} specs</span>}
                        </div>
                        <p className="candidate-url" title={c.url}>{c.url}</p>
                        <div className="candidate-actions">
                          <Button size="sm" variant="secondary" icon="file" onClick={() => runExtractSpecs(c)}>Extract specs</Button>
                          <Button size="sm" variant="primary" icon="check" onClick={() => linkToEquipment(c)} disabled={!selectedEquipment}>Add manual</Button>
                          <Button size="sm" variant="ghost" icon="external" onClick={() => window.open(c.url, '_blank')}>Open</Button>
                          <Button size="sm" variant="ghost" icon="x" onClick={() => dismissCandidate(c)}>Dismiss</Button>
                        </div>
                        {Object.keys(c.specsPreview).length > 0 && (
                          <details>
                            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '.62rem' }}>Extracted specs</summary>
                            <pre className="candidate-specs" style={{ marginBlockStart: 8 }}>{JSON.stringify(c.specsPreview, null, 2)}</pre>
                          </details>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </Surface>
          )}

          {activeTab === 'session' && (
            <Surface>
              <div className="surface-header"><div className="surface-title"><Icon name="activity" size={17} /><div><h2>Jobs from this session</h2><p>Only jobs run in this browser tab; reloading clears the list.</p></div></div></div>
              <div className="surface-body">
                {jobs.filter(j => j.status === 'completed').length === 0 ? (
                  <EmptyState icon="activity" title="No completed jobs yet" description="Run a search or manufacturer research to see its outcome here." />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Query</th><th>Type</th><th>Status</th><th>Results</th><th>Time</th></tr></thead>
                      <tbody>
                        {jobs.filter(j => j.status === 'completed').map(job => (
                          <tr key={job.id}>
                            <td><span className="table-name"><strong>{job.query.slice(0, 60)}</strong></span></td>
                            <td><span className="tag tag-acid">{job.type}</span></td>
                            <td><StatusDot tone="success" label="Done" /></td>
                            <td>{Array.isArray(job.results?.results) ? job.results.results.length : job.results?.results?.length || 0} items</td>
                            <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>{new Date(job.createdAt).toLocaleString()}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Surface>
          )}
        </div>
      </div>
    </>
  );
};

export default ResearchAgent;