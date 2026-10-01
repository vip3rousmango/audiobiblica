import React, { useCallback, useEffect, useState } from 'react';

import {
  EasyschematicStatus,
  EsExport,
  EsVocabulary,
  exportEsDevices,
  getEasyschematicStatus,
  getEsSuggestion,
  listEquipment,
} from '../lib/api';
import { Button, InlineNotice, Surface } from './ui';
import { Icon } from './Icon';

interface Props {
  onToast: (message: string, type?: 'success' | 'error') => void;
}

const EsSettings: React.FC<Props> = ({ onToast }) => {
  const [status, setStatus] = useState<EasyschematicStatus | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [bulk, setBulk] = useState<EsExport | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deviceTypes, setDeviceTypes] = useState<Record<string, string>>({});
  const [vocabulary, setVocabulary] = useState<EsVocabulary | null>(null);

  useEffect(() => {
    let alive = true;
    void getEasyschematicStatus()
      .then((value) => {
        if (!alive) return;
        setStatus(value);
        setShowInstall(!value.running);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const runBulk = useCallback(async (types: Record<string, string>) => {
    setBulkBusy(true);
    try {
      const exportResult = await exportEsDevices({ ids: [], device_types: types });
      setBulk(exportResult);
      if (!vocabulary) {
        // The vocabulary never changes across a session; reuse the suggest-less vocabulary from
        // the first export by fetching one device's suggestion is overkill — read it lazily below.
        void fetchVocabularyOnce();
      }
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : 'Could not build the catalog export.', 'error');
    } finally {
      setBulkBusy(false);
    }
  }, [onToast, vocabulary]);

  const fetchVocabularyOnce = async () => {
    if (vocabulary) return;
    const first = (await listEquipment()).find((item) => !item.archived);
    if (!first) {
      setVocabulary(null);
      return;
    }
    const suggestion = await getEsSuggestion(first.id);
    setVocabulary(suggestion.vocabulary);
  };

  const downloadBulk = () => {
    if (!bulk || bulk.devices.length === 0) return;
    const body = JSON.stringify(bulk.devices, null, 2);
    const blob = new Blob([body], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'audiobiblica-devices.json';
    anchor.click();
    URL.revokeObjectURL(url);
    onToast(`Saved ${bulk.devices.length} device${bulk.devices.length === 1 ? '' : 's'}.`);
  };

  const copyBulk = async () => {
    if (!bulk || bulk.devices.length === 0) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(bulk.devices, null, 2));
      onToast(`Copied ${bulk.devices.length} device${bulk.devices.length === 1 ? '' : 's'}.`);
    } catch {
      onToast('Select the text and copy it by hand.', 'error');
    }
  };

  const installLine = status ? status.install.one_line.replace('{origin}', window.location.origin) : '';

  return (
    <Surface>
      <h2 style={{ marginBlockEnd: 6 }}>EasySchematic</h2>
      <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBlockEnd: 16, maxWidth: '60ch' }}>
        The drawing app your devices belong in. AudioBiblica sends them with the ports they really
        have; EasySchematic receives the file its own import accepts.
      </p>

      {status && (
        <>
          <div className="service-block" style={{ marginBlockEnd: 12 }}>
            <div className="service-row">
              <span className="status-dot" style={{ color: status.detected.ui ? 'var(--teal)' : 'var(--muted)' }}>{status.detected.ui ? 'running' : 'closed'}</span>
              <span className="service-label">EasySchematic app</span>
              <span className="service-detail">{status.detected.ui?.url ?? 'not answering here'}</span>
            </div>
            <div className="service-row">
              <span className="status-dot" style={{ color: status.detected.api ? 'var(--teal)' : 'var(--muted)' }}>{status.detected.api ? 'ready' : 'closed'}</span>
              <span className="service-label">Device library</span>
              <span className="service-detail">
                {status.detected.api ? `${status.detected.api.templates ?? '—'} templates` : 'not answering here'}
              </span>
            </div>
          </div>
          <p style={{ fontSize: '0.7rem', marginBlockEnd: 16 }}>{status.advice}</p>
          {status.detected.ui && (
            <a href={status.detected.ui.url ?? undefined} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: 'var(--teal)' }}>
              Open EasySchematic <Icon name="arrow-up-right" size={11} />
            </a>
          )}
        </>
      )}

      {status && showInstall && (
        <div style={{ marginBlockStart: 16 }}>
          <InlineNotice tone="info" icon="plug">
            {status.running
              ? 'It is running, so we will use it and never install a second one.'
              : 'To run EasySchematic on this computer, one command does it. It checks first and will not install a second copy if one appears.'}
          </InlineNotice>
          {!status.running && (
            <div style={{ marginBlockStart: 12, display: 'grid', gap: 8 }}>
              {status.install.steps.map((step) => (
                <p key={step} style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>· {step}</p>
              ))}
              <div className="es-command" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: '0.62rem', overflowWrap: 'anywhere', background: 'var(--panel)', padding: '10px', borderRadius: 8 }}>{installLine}</code>
                <Button variant="secondary" size="sm" icon="copy" onClick={() => {
                  void navigator.clipboard.writeText(installLine).then(
                    () => onToast('Command copied. Paste it into Terminal to install EasySchematic.'),
                    () => onToast('Select the text and copy it by hand.', 'error'),
                  );
                }}>Copy</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBlockStart: 24 }}>
        <h3 style={{ fontSize: '0.8rem', marginBlockEnd: 6 }}>Send the whole catalog</h3>
        <p style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBlockEnd: 10 }}>
          One file with every active device, ports from each device's own "Send to EasySchematic"
          choices where they were made; everything else goes as its category's starting draft —
          adjust them from each device's details first if that matters.
        </p>
        <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" icon="file" disabled={bulkBusy} onClick={() => void runBulk(deviceTypes)}>
            {bulkBusy ? 'Building…' : 'Prepare everything'}
          </Button>
          <Button variant="primary" size="sm" icon="download" disabled={bulkBusy || !bulk || bulk.devices.length === 0} onClick={downloadBulk}>Download file</Button>
          <Button variant="secondary" size="sm" icon="copy" disabled={bulkBusy || !bulk || bulk.devices.length === 0} onClick={() => void copyBulk()}>Copy JSON</Button>
        </div>

        {bulk && bulk.skipped.length > 0 && (
          <div style={{ marginBlockStart: 12 }}>
            <InlineNotice tone="warning" icon="filter">
              {bulk.skipped.length} device{bulk.skipped.length === 1 ? ' is' : 's are'} waiting for a
              kind — the word that says what the device is in the drawing.
            </InlineNotice>
            {bulk.skipped.map((item) => (
              <div key={item.id} style={{ display: 'grid', gap: 4, marginBlockStart: 8 }}>
                <span style={{ fontSize: '0.68rem' }}>{item.name}</span>
                <select
                  value={deviceTypes[item.id] ?? ''}
                  aria-label={`Device kind for ${item.name}`}
                  onChange={(event) => {
                    const next = { ...deviceTypes, [item.id]: event.target.value };
                    setDeviceTypes(next);
                    void runBulk(next);
                  }}
                >
                  <option value="">Pick a device kind…</option>
                  {vocabulary &&
                    Object.entries(vocabulary.device_types).map(([kind]) => (
                      <option key={kind} value={kind}>{kind}</option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {bulk && bulk.devices.length > 0 && (
          <p style={{ fontSize: '0.7rem', marginBlockStart: 12, color: 'var(--muted)' }}>
            {bulk.devices.length} device{bulk.devices.length === 1 ? '' : 's'} ready
            {bulk.warnings.length ? ` — ${bulk.warnings.join(' ')}` : '.'}
          </p>
        )}
      </div>
    </Surface>
  );
};

export default EsSettings;