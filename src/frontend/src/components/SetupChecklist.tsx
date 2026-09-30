import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SetupStatus, getSetupStatus, pullModel } from '../lib/api';
import { Icon } from '../components/Icon';
import { Button, InlineNotice, Surface } from '../components/ui';

const DEFAULT_MODEL = 'llama3.2:3b';

/* First run, in plain language: three steps a musician can complete without
   reading any documentation. The panel disappears once all three are done. */
const SetupChecklist: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [pullError, setPullError] = useState('');
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getSetupStatus());
    } catch {
      // The page already reports an unreachable backend; stay quiet here.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pulling = status?.assistant.pulling === 'pulling';

  useEffect(() => {
    if (!pulling) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pulling, refresh]);

  const downloadModel = useCallback(async () => {
    // Pull the model the app is configured to use: that is the one the step is
    // waiting for. Any other name would never turn the step green.
    const model = status?.assistant.model || DEFAULT_MODEL;
    setStarting(true);
    setPullError('');
    try {
      await pullModel(model);
      await refresh();
    } catch (error) {
      setPullError(error instanceof Error ? error.message : 'The download could not start.');
    } finally {
      setStarting(false);
    }
  }, [refresh, status?.assistant.model]);

  if (!status) return null;

  const deviceCount = status.equipment_count;
  const manualCount = status.manual_count;
  const { assistant } = status;

  /* Kept even when the setup checklist itself is finished: a catalog that had to
     be repaired is exactly the moment the user needs to be told, and the notice
     clears by itself on the next clean start. */
  const recovery = status.catalog_recovery;
  const recoveryNotice = recovery && (
    <InlineNotice tone="warning" icon="refresh">
      {recovery.action === 'restored'
        ? `Your catalog could not be read, so AudioBiblica restored the copy from ${new Date(recovery.at).toLocaleString()}. The damaged file was kept at ${recovery.broken_file}.`
        : `Your catalog could not be read and no usable backup was found, so AudioBiblica started with an empty one. The damaged file was kept at ${recovery.broken_file}.`}
    </InlineNotice>
  );
  const complete = deviceCount > 0 && manualCount > 0 && assistant.model_available;
  if (complete && !recovery) return null;

  /* An unreadable catalog means the step counts above are not real, so the only
     honest thing to show is where to fix it. */
  if (!status.catalog_readable) {
    return (
      <>
        {recoveryNotice}
        <InlineNotice tone="danger" icon="x">
          AudioBiblica cannot read your catalog right now, so it cannot show your gear. Open Settings → Check my setup to fix it.
        </InlineNotice>
      </>
    );
  }

  if (complete) {
    return <>{recoveryNotice}</>;
  }
  return (
    <Surface className="setup-checklist">
      {recoveryNotice}
      <div className="surface-header">
        <div className="surface-title">
          <Icon name="check" size={17} />
          <div>
            <h2>Three steps to a useful library</h2>
            <p>Nothing here needs an account, and your files stay on this computer.</p>
          </div>
        </div>
      </div>
      <div className="surface-body">
        <ol className="setup-steps">
          <li className={`setup-step${deviceCount > 0 ? ' is-done' : ''}`}>
            <span className="setup-step-index" aria-hidden="true">
              {deviceCount > 0 ? <Icon name="check" size={13} /> : 1}
            </span>
            <div className="setup-step-copy">
              <strong>Add your first device</strong>
              <p>A name, a make and a category are enough to begin.</p>
              <Button size="sm" variant="primary" icon="plus" onClick={() => navigate('/library?new=1')}>
                Add a device
              </Button>
            </div>
          </li>
          <li className={`setup-step${manualCount > 0 ? ' is-done' : ''}`}>
            <span className="setup-step-index" aria-hidden="true">
              {manualCount > 0 ? <Icon name="check" size={13} /> : 2}
            </span>
            <div className="setup-step-copy">
              <strong>Import a manual or two</strong>
              <p>PDFs you already own work offline. You can also paste a product page link.</p>
              <Button size="sm" variant="secondary" icon="book" onClick={() => navigate('/library')}>
                Go to your library
              </Button>
            </div>
          </li>
          <li className={`setup-step${assistant.model_available ? ' is-done' : ''}`}>
            <span className="setup-step-index" aria-hidden="true">
              {assistant.model_available ? <Icon name="check" size={13} /> : 3}
            </span>
            <div className="setup-step-copy">
              <strong>Switch on the assistant</strong>
              {assistant.model_available ? (
                <p>The assistant is ready. Ask it anything about the gear in your catalog.</p>
              ) : assistant.reachable ? (
                <>
                  <p>Download once, then ask questions about your gear.</p>
                  {pulling ? (
                    <p className="setup-progress">Downloading… this can take a few minutes.</p>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon="sparkles"
                      disabled={starting}
                      onClick={() => void downloadModel()}
                    >
                      Download the assistant model (about 2 GB)
                    </Button>
                  )}
                </>
              ) : (
                <p>
                  Install Ollama once from <a href="https://ollama.com/download">ollama.com/download</a>,
                  then reopen this page.
                </p>
              )}
            </div>
          </li>
        </ol>
        {pullError && <InlineNotice tone="danger">{pullError}</InlineNotice>}
        {assistant.pull_error && <InlineNotice tone="danger">{assistant.pull_error}</InlineNotice>}
      </div>
    </Surface>
  );
};

export default SetupChecklist;
