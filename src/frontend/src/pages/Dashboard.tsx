import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Equipment, getHealth, getSetupStatus, listEquipment, SetupStatus } from '../lib/api';
import { Icon } from '../components/Icon';
import { Button, EmptyState, PageHeader, StatusDot, Surface } from '../components/ui';
import SetupChecklist from '../components/SetupChecklist';

interface ServiceState {
  label: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  icon: 'server' | 'database' | 'plug' | 'sparkles';
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    setError('');
    const [equipmentResult, healthResult, setupResult] = await Promise.allSettled([
      listEquipment(),
      getHealth(),
      getSetupStatus(),
    ]);

    if (equipmentResult.status === 'fulfilled') {
      setEquipment(equipmentResult.value);
    } else {
      setError('The catalog could not be reached. You can still explore the workspace and reconnect later.');
    }
    setApiOnline(healthResult.status === 'fulfilled' && healthResult.value.status === 'ok');
    setSetupStatus(setupResult.status === 'fulfilled' ? setupResult.value : null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const manualCount = equipment.reduce((count, item) => count + (item.manuals?.length ?? 0), 0);
  const manufacturerCount = new Set(equipment.map((item) => item.manufacturer).filter(Boolean)).size;
  const assistant = setupStatus?.assistant ?? null;
  const assistantDetail = assistant
    ? assistant.model_available
      ? 'Ready to answer'
      : assistant.reachable
        ? 'Needs a model'
        : 'Not connected'
    : 'Checking…';
  const serviceStates: ServiceState[] = [
    { label: 'AudioBiblica service', detail: apiOnline === true ? 'Running' : apiOnline === false ? 'Not running' : 'Checking…', tone: apiOnline === true ? 'success' : apiOnline === false ? 'danger' : 'neutral', icon: 'server' },
    { label: 'Your catalog', detail: `${equipment.length} ${equipment.length === 1 ? 'item' : 'items'}`, tone: equipment.length > 0 ? 'success' : 'warning', icon: 'database' },
    { label: 'Assistant', detail: assistantDetail, tone: assistant === null ? 'neutral' : assistant.model_available ? 'success' : assistant.reachable ? 'warning' : 'neutral', icon: 'sparkles' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Workspace overview"
        title="Your AV knowledge, in one place."
        description="A calm control surface for cataloguing gear, enriching manuals, and giving your tools reliable technical context."
        actions={<Button variant="primary" icon="plus" onClick={() => navigate('/library?new=1')}>Add equipment</Button>}
      />

      <SetupChecklist />

      {error && <div className="page-notice"><span>{error}</span><Button size="sm" variant="ghost" icon="refresh" onClick={() => void loadDashboard()}>Reconnect</Button></div>}

      <section aria-label="Catalog metrics" className="metric-grid">
        <article className="metric-card metric-acid">
          <div className="metric-card-top"><span className="metric-label">Inventory</span><span className="metric-icon"><Icon name="package" size={15} /></span></div>
          <p className="metric-value">{loading ? '—' : equipment.length}</p>
          <span className="metric-footnote">catalogued devices</span>
        </article>
        <article className="metric-card metric-teal">
          <div className="metric-card-top"><span className="metric-label">Documentation</span><span className="metric-icon"><Icon name="book" size={15} /></span></div>
          <p className="metric-value">{loading ? '—' : manualCount}</p>
          <span className="metric-footnote">linked manuals</span>
        </article>
        <article className="metric-card metric-blue">
          <div className="metric-card-top"><span className="metric-label">Manufacturers</span><span className="metric-icon"><Icon name="globe" size={15} /></span></div>
          <p className="metric-value">{loading ? '—' : manufacturerCount}</p>
          <span className="metric-footnote">represented brands</span>
        </article>
        <article className="metric-card metric-amber">
          <div className="metric-card-top"><span className="metric-label">Manuals indexed</span><span className="metric-icon"><Icon name="book" size={15} /></span></div>
          <p className="metric-value">{loading ? '—' : manualCount}</p>
          <span className="metric-footnote">PDFs and links you've added</span>
        </article>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-stack">
          <Surface>
            <div className="surface-header">
              <div className="surface-title"><Icon name="activity" size={17} /><div><h2>Start with a clear next step</h2><p>Build the knowledge base your studio depends on.</p></div></div>
            </div>
            <div className="surface-body action-grid">
              <button className="action-card" onClick={() => navigate('/library?new=1')}>
                <span className="action-card-icon"><Icon name="plus" size={17} /></span>
                <span><strong>Add a device</strong><br /><span>Create an equipment record with the details you already know.</span></span>
              </button>
              <button className="action-card" onClick={() => navigate('/research')}>
                <span className="action-card-icon"><Icon name="research" size={17} /></span>
                <span><strong>Research a model</strong><br /><span>Find a manual by pasting a link, importing a PDF, or searching the web.</span></span>
              </button>
              <button className="action-card" onClick={() => navigate('/nanobot')}>
                <span className="action-card-icon"><Icon name="sparkles" size={17} /></span>
                <span><strong>Ask the assistant</strong><br /><span>Compare devices, plan a signal chain, or diagnose a setup.</span></span>
              </button>
            </div>
          </Surface>

          <Surface>
            <div className="surface-header">
              <div className="surface-title"><Icon name="library" size={17} /><div><h2>Recent catalog activity</h2><p>Latest records in your equipment knowledge base.</p></div></div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>View library <Icon name="arrow-up-right" size={13} /></Button>
            </div>
            <div className="surface-body">
              {equipment.length === 0 ? (
                <EmptyState icon="package" title="Your catalog is ready for its first record" description="Add the gear you rely on so every future search, research job, and assistant answer has a reliable source of truth." action={<Button size="sm" variant="secondary" icon="plus" onClick={() => navigate('/library?new=1')}>Add first device</Button>} />
              ) : (
                <div className="activity-list">
                  {equipment.slice(0, 5).map((item) => (
                    <div className="activity-row" key={item.id}>
                      <span className="activity-icon"><Icon name="package" size={15} /></span>
                      <span className="activity-copy"><strong>{item.name}</strong><span>{item.manufacturer}{item.model ? ` · ${item.model}` : ''}</span></span>
                      <span className="activity-time">{item.category || 'equipment'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Surface>
        </div>

        <Surface>
          <div className="surface-header">
            <div className="surface-title"><Icon name="server" size={17} /><div><h2>System pulse</h2><p>Local services and data readiness.</p></div></div>
            <Button variant="ghost" size="sm" icon="refresh" aria-label="Refresh system status" onClick={() => void loadDashboard()} disabled={refreshing} />
          </div>
          <div className="surface-body">
            <div className="service-list">
              {serviceStates.map((service) => (
                <div className="service-row" key={service.label}>
                  <div className="service-leading"><span className="activity-icon"><Icon name={service.icon} size={15} /></span><span className="service-copy"><strong>{service.label}</strong><span>{service.detail}</span></span></div>
                  <StatusDot tone={service.tone} />
                </div>
              ))}
            </div>
            <div style={{ marginBlockStart: 21 }}><Button variant="secondary" size="sm" onClick={() => navigate('/mcp')}>Open advanced tools <Icon name="arrow-up-right" size={13} /></Button></div>
          </div>
        </Surface>
      </div>
    </>
  );
};

export default Dashboard;
