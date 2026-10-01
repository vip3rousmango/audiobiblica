import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  approveFindings,
  CoverageRow,
  deleteResearchFinding,
  Equipment,
  getResearchCoverage,
  getResearchPlan,
  getResearchQueue,
  getResearchRun,
  listEquipment,
  ResearchFinding,
  ResearchPlan,
  ResearchRun,
  ResearchStepState,
  startResearchRun,
} from '../lib/api';
import { Icon } from '../components/Icon';
import RunTree from '../components/RunTree';
import { streamResearchRun } from '../lib/runStream';
import { Button, EmptyState, InlineNotice, PageHeader, StatusDot, Surface } from '../components/ui';

/* Research, as a run you watch rather than a row of buttons.
 *
 * A device has a plan: the questions worth asking of that kind of device. Running it walks those
 * questions one at a time — your own catalog first, then the text of the manuals you have, then the
 * pages you have linked, then whatever services you have brought keys for — and every answer lands in
 * the queue for you to confirm before it counts as something known.
 *
 * Three states matter as much as the answers: a step that found nothing says so, a step whose key is
 * missing says so, and a step that failed says why. None of them is silently empty. */

const POLL_MS = 1500;

/* What each step state looks like at a glance. */
const STATE_COPY: Record<string, { mark: string; label: string }> = {
  queued: { mark: '·', label: 'Waiting' },
  running: { mark: '·', label: 'Working' },
  done: { mark: '✓', label: 'Found something' },
  empty: { mark: '–', label: 'Nothing found' },
  'needs-key': { mark: '$', label: 'Needs a key' },
  failed: { mark: '!', label: 'Failed' },
};

const CATEGORY_LABEL: Record<string, string> = {
  manual: 'Manual',
  specs: 'Specs',
  connections: 'Connections',
  sources: 'Sources',
  settings: 'Settings',
  compatibility: 'Pairs with',
};

const ResearchAgent: React.FC = () => {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [running, setRunning] = useState(false);
  const [queue, setQueue] = useState<ResearchFinding[]>([]);
  const [coverage, setCoverage] = useState<{ devices: CoverageRow[]; totals: Record<string, number> } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'danger'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyFinding, setBusyFinding] = useState<string | null>(null);
  const [view, setView] = useState<'tree' | 'rail'>('tree');
  const [streaming, setStreaming] = useState(false);
  const runIdRef = useRef<string | null>(null);

  const refreshLists = useCallback(async () => {
    try {
      const [items, queued, matrix] = await Promise.all([
        listEquipment(),
        getResearchQueue(),
        getResearchCoverage(),
      ]);
      const active = items.filter((item) => !item.archived);
      setEquipment(active);
      setQueue(queued);
      setCoverage(matrix);
      setSelectedId((current) => current || active[0]?.id || '');
    } catch (caught) {
      setNotice({ tone: 'danger', text: caught instanceof Error ? caught.message : 'Could not load research.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  /* The plan for the selected device: what a run would ask, before anything runs. */
  useEffect(() => {
    if (!selectedId) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void getResearchPlan(selectedId)
      .then((loaded) => { if (!cancelled) setPlan(loaded); })
      .catch(() => { if (!cancelled) setPlan(null); });
    return () => { cancelled = true; };
  }, [selectedId]);

  /* A run is watched, not awaited: the server streams each step the moment it is produced, and the
     steps are applied where they belong so the tree grows rather than re-rendering. */
  useEffect(() => {
    const runId = runIdRef.current;
    if (!running || !runId) return;
    let finished = false;
    const stop = streamResearchRun(
      runId,
      (event) => {
        if (event.type === 'finished') {
          finished = true;
          setRun(event.run ?? null);
          setRunning(false);
          runIdRef.current = null;
          void refreshLists();
          return;
        }
        if (event.type === 'run' && event.run) {
          setRun(event.run);
          return;
        }
        if (event.type === 'step' && event.step_id) {
          setRun((current) => current && current.steps
            ? { ...current, steps: current.steps.map((step) => step.step_id === event.step_id
                ? { ...step, state: event.state ?? step.state, detail: event.detail ?? null, error: event.error ?? null, evidence: event.evidence ?? step.evidence }
                : step) }
            : current);
        }
      },
      () => { if (!finished) setStreaming(false); },
    );
    return stop;
  }, [running, refreshLists]);

  /* The fallback: if the stream cannot be used, the run is still followed, just less smoothly. */
  useEffect(() => {
    if (!running || streaming || !runIdRef.current) return;
    const timer = window.setInterval(() => {
      void getResearchRun(runIdRef.current as string)
        .then((current) => {
          setRun(current);
          if (current.status !== 'running') {
            setRunning(false);
            runIdRef.current = null;
            void refreshLists();
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, streaming, refreshLists]);

  const start = async () => {
    if (!selectedId) return;
    setNotice(null);
    try {
      const started = await startResearchRun(selectedId);
      runIdRef.current = started.id;
      setRun(started);
      setStreaming(true);
      setRunning(true);
    } catch (caught) {
      setNotice({ tone: 'danger', text: caught instanceof Error ? caught.message : 'That run could not start.' });
    }
  };

  const approve = async (finding: ResearchFinding) => {
    setBusyFinding(finding.id);
    try {
      await approveFindings([finding.id]);
      await refreshLists();
    } catch (caught) {
      setNotice({ tone: 'danger', text: caught instanceof Error ? caught.message : 'Could not approve that.' });
    } finally {
      setBusyFinding(null);
    }
  };

  const approveAllFor = async (equipmentId: string) => {
    const ids = queue.filter((item) => item.equipment_id === equipmentId).map((item) => item.id);
    if (ids.length === 0) return;
    setBusyFinding(equipmentId);
    try {
      await approveFindings(ids);
      await refreshLists();
    } catch (caught) {
      setNotice({ tone: 'danger', text: caught instanceof Error ? caught.message : 'Could not approve those.' });
    } finally {
      setBusyFinding(null);
    }
  };

  const dismiss = async (finding: ResearchFinding) => {
    setBusyFinding(finding.id);
    try {
      await deleteResearchFinding(finding.equipment_id, finding.id);
      await refreshLists();
    } catch (caught) {
      setNotice({ tone: 'danger', text: caught instanceof Error ? caught.message : 'Could not dismiss that.' });
    } finally {
      setBusyFinding(null);
    }
  };

  const selected = useMemo(() => equipment.find((item) => item.id === selectedId), [equipment, selectedId]);
  const steps: ResearchStepState[] = run?.steps ?? [];
  const totalSteps = run ? steps.length : plan?.steps.length ?? 0;
  const finished = steps.filter((step) => step.state !== 'queued' && step.state !== 'running').length;
  const queueByDevice = useMemo(() => {
    const grouped = new Map<string, ResearchFinding[]>();
    for (const finding of queue) {
      const list = grouped.get(finding.equipment_id) ?? [];
      list.push(finding);
      grouped.set(finding.equipment_id, list);
    }
    return grouped;
  }, [queue]);

  const totals = coverage?.totals ?? {};

  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Research queue"
        description="Ask the questions worth asking about each device, watch them being answered, and confirm what counts as known."
      />

      {notice && <InlineNotice tone={notice.tone} icon={notice.tone === 'danger' ? 'x' : 'activity'}>{notice.text}</InlineNotice>}

      <Surface>
        <div className="surface-body">
          <div className="library-toolbar">
            <div className="research-summary" aria-label="What is known across the catalog">
              <span className="batch-count">{totals.devices ?? 0} devices</span>
              <StatusDot tone="success" label={`${totals.complete ?? 0} fully documented`} />
              <StatusDot tone="warning" label={`${totals.missing_manual ?? 0} missing a manual`} />
              <StatusDot tone="neutral" label={`${totals.pending_findings ?? 0} waiting to be reviewed`} />
            </div>
            <label className="field-help" htmlFor="research-device">Device</label>
            <select
              id="research-device"
              className="select-control"
              value={selectedId}
              disabled={running}
              onChange={(event) => { setSelectedId(event.target.value); setRun(null); }}
            >
              {equipment.length === 0 && <option value="">No devices yet</option>}
              {equipment.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <Button variant="primary" icon="research" disabled={!selectedId || running} onClick={() => void start()}>
              {running ? 'Researching…' : 'Run research'}
            </Button>
          </div>
        </div>
      </Surface>

      <div className="research-layout" style={{ marginBlockStart: 16 }}>
        <Surface>
          <div className="surface-header">
            <div className="surface-title">
              <Icon name="activity" size={17} />
              <div>
                <h2>{run ? `Run for ${selected?.name ?? 'this device'}` : 'The plan'}</h2>
                <p>
                  {run?.summary
                    ? run.summary
                    : `${totalSteps} steps for a ${selected?.category ?? 'device'} — ${plan?.steps.filter((step) => step.ready === false).length ?? 0} need a key.`}
                </p>
              </div>
            </div>
            {run && <span className="run-meta">{finished} / {totalSteps}</span>}
          </div>
          <div className="surface-body">
            {!plan && !run && (
              <EmptyState
                icon="research"
                title="No device selected"
                description="Add a device to the library and its research plan appears here."
              />
            )}

            {plan && !run && (
              <div className="research-plan">
                {plan.steps.map((step) => (
                  <article className={`plan-step ${step.ready === false ? 'step-needs-key' : ''}`} key={step.id}>
                    <span className="plan-step-mark" aria-hidden="true">{step.ready === false ? '$' : '·'}</span>
                    <div className="plan-step-body">
                      <h3 className="plan-step-title">
                        {step.title}
                        <span className="tag">{CATEGORY_LABEL[step.dimension] ?? step.dimension}</span>
                      </h3>
                      <p className="plan-step-question">{step.question}</p>
                      {step.ready === false && (
                        <p className="plan-step-detail">
                          Needs a {step.needs_key} key — add one in Settings → Research sources and this step runs too.
                        </p>
                      )}
                    </div>
                    <span className="tag plan-step-tool">{step.tool}</span>
                  </article>
                ))}
              </div>
            )}

            {run && (
              <>
                {run.summary && <p className="run-summary">{run.summary}</p>}
                <div className="run-view-toggle" role="group" aria-label="How to show the run">
                  <button className={view === 'tree' ? 'active' : ''} aria-pressed={view === 'tree'} onClick={() => setView('tree')}>Tree</button>
                  <button className={view === 'rail' ? 'active' : ''} aria-pressed={view === 'rail'} onClick={() => setView('rail')}>List</button>
                </div>
                {view === 'tree' && (
                  <RunTree steps={steps} plan={plan} running={running} summary={run.summary} />
                )}
                {view === 'rail' && <div className="research-plan">
                  {steps.map((step) => {
                    const copy = STATE_COPY[step.state] ?? STATE_COPY.queued;
                    return (
                      <article className={`plan-step step-${step.state}`} key={step.step_id}>
                        <span className="plan-step-mark" aria-hidden="true" title={copy.label}>{copy.mark}</span>
                        <div className="plan-step-body">
                          <h3 className="plan-step-title">
                            {step.title}
                            <span className="tag">{CATEGORY_LABEL[step.dimension] ?? step.dimension}</span>
                          </h3>
                          <p className="plan-step-detail">
                            {step.detail || copy.label}
                            {step.error ? ` (${step.error})` : ''}
                          </p>
                          {step.evidence.length > 0 && (
                            <ul className="plan-step-evidence">
                              {step.evidence.map((item, index) => (
                                <li key={`${step.step_id}-${index}`}>
                                  {item.url
                                    ? <a href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>
                                    : <strong>{item.title || 'Your catalog'}</strong>}
                                  {item.snippet && <span>{item.snippet}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <span className="tag plan-step-tool">{step.tool}</span>
                      </article>
                    );
                  })}
                </div>}
              </>
            )}
          </div>
        </Surface>

        <Surface>
          <div className="surface-header">
            <div className="surface-title">
              <Icon name="layers" size={17} />
              <div>
                <h2>Waiting for you</h2>
                <p>What runs found. Nothing counts as known until you confirm it.</p>
              </div>
            </div>
            {queue.length > 0 && <span className="run-meta">{queue.length}</span>}
          </div>
          <div className="surface-body">
            {loading ? (
              <p className="field-help">Loading…</p>
            ) : queue.length === 0 ? (
              <EmptyState
                icon="check"
                title="Nothing waiting"
                description="Run research on a device, or add a key in Settings → Research sources to ask more of it."
              />
            ) : (
              [...queueByDevice.entries()].map(([equipmentId, findings]) => (
                <section key={equipmentId} aria-label={findings[0]?.equipment_name ?? equipmentId}>
                  <div className="queue-head" style={{ marginBlockStart: 4 }}>
                    <strong>{findings[0]?.equipment_name ?? 'Unknown device'}</strong>
                    <span className="queue-source">{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="check"
                      disabled={busyFinding === equipmentId}
                      onClick={() => void approveAllFor(equipmentId)}
                    >
                      Approve all
                    </Button>
                  </div>
                  {findings.map((finding) => (
                    <article className="queue-item" key={finding.id}>
                      <div className="queue-head">
                        <strong>{finding.title}</strong>
                        {finding.dimension && <span className="tag">{CATEGORY_LABEL[finding.dimension] ?? finding.dimension}</span>}
                        {finding.source_url && (
                          <a className="queue-source" href={finding.source_url} target="_blank" rel="noreferrer">source</a>
                        )}
                      </div>
                      <p className="queue-body">{finding.content}</p>
                      <div className="queue-actions">
                        <Button size="sm" variant="primary" icon="check" disabled={busyFinding === finding.id} onClick={() => void approve(finding)}>
                          Keep
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyFinding === finding.id} onClick={() => void dismiss(finding)}>
                          Dismiss
                        </Button>
                      </div>
                    </article>
                  ))}
                </section>
              ))
            )}
          </div>
        </Surface>
      </div>

      <Surface style={{ marginBlockStart: 16 }}>
        <div className="surface-header">
          <div className="surface-title">
            <Icon name="grid" size={17} />
            <div>
              <h2>What is missing</h2>
              <p>Every device against the questions its category asks, gaps first.</p>
            </div>
          </div>
        </div>
        <div className="surface-body">
          {(coverage?.devices.length ?? 0) === 0 ? (
            <p className="field-help">Nothing to show yet.</p>
          ) : (
            <div className="coverage-grid">
              {coverage?.devices.map((row) => (
                <div className="coverage-row" key={row.equipment_id}>
                  <div className="coverage-name">
                    <strong>{row.name}</strong>
                    <span>{row.category} · {row.missing.length === 0 ? 'complete' : `${row.missing.length} missing`}</span>
                  </div>
                  {row.dimensions.map((dimension) => (
                    <span
                      className={`coverage-cell ${row.covered.includes(dimension) ? 'coverage-covered' : row.pending > 0 ? 'coverage-pending' : 'coverage-gap'}`}
                      key={`${row.equipment_id}-${dimension}`}
                      title={CATEGORY_LABEL[dimension] ?? dimension}
                    >
                      {CATEGORY_LABEL[dimension] ?? dimension}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </Surface>
    </>
  );
};

export default ResearchAgent;
