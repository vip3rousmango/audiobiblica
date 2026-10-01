import React, { useCallback, useEffect, useState } from 'react';

import {
  EsPort,
  EsSuggestion,
  EsVocabulary,
  getEasyschematicStatus,
  getEsSuggestion,
  exportEsDevices,
} from '../lib/api';
import { Button, InlineNotice } from './ui';
import { Icon } from './Icon';

interface Props {
  equipmentId: string;
}

const blankPort = (): EsPort => ({ label: '', signalType: 'analog-audio', connectorType: 'combo-xlr-trs', direction: 'input' });

function groupByCategory(vocabulary: EsVocabulary): Array<{ category: string; kinds: string[] }> {
  const byCategory = new Map<string, string[]>();
  for (const [kind, category] of Object.entries(vocabulary.device_types)) {
    byCategory.set(category, [...(byCategory.get(category) ?? []), kind]);
  }
  return [...byCategory.entries()]
    .map(([category, kinds]) => ({ category, kinds: kinds.sort() }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/** Author a catalog device the way the user actually owns it, and hand it to EasySchematic as the
    JSON its own import accepts. The panel edits a draft; the download button is the commit. */
const SendToEasySchematic: React.FC<Props> = ({ equipmentId }) => {
  const [suggestion, setSuggestion] = useState<EsSuggestion | null>(null);
  const [deviceType, setDeviceType] = useState('');
  const [ports, setPorts] = useState<EsPort[]>([]);
  const [portsTouched, setPortsTouched] = useState(false);
  const [advice, setAdvice] = useState<string | null>(null);
  const [esUrl, setEsUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'danger' | 'success'>('danger');
  const [busy, setBusy] = useState(false);

  const chooseKind = useCallback(
    async (kind: string) => {
      setDeviceType(kind);
      if (portsTouched || !kind) return;
      // An untouched port list is a suggestion, not a decision: swap it for the new kind's draft.
      try {
        const value = await getEsSuggestion(equipmentId, kind);
        setSuggestion(value);
        setPorts(value.ports.map((port) => ({ ...port })));
      } catch {
        setMessageTone('danger');
        setMessage('Could not suggest ports for this kind; add them by hand.');
      }
    },
    [equipmentId, portsTouched],
  );

  useEffect(() => {
    let alive = true;
    void getEsSuggestion(equipmentId)
      .then((value) => {
        if (!alive) return;
        setSuggestion(value);
        setDeviceType(value.suggested_device_type ?? '');
        setPorts(value.ports.map((port) => ({ ...port })));
      })
      .catch(() => undefined);
    void getEasyschematicStatus()
      .then((value) => {
        if (!alive) return;
        setAdvice(value.advice);
        setEsUrl(value.detected.ui?.url ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [equipmentId]);

  const setPort = useCallback((index: number, patch: Partial<EsPort>) => {
    setPortsTouched(true);
    setPorts((current) => current.map((port, i) => (i === index ? { ...port, ...patch } : port)));
  }, []);

  const exportPayload = useCallback(async () => {
    const exportResult = await exportEsDevices({
      ids: [equipmentId],
      ports: { [equipmentId]: ports },
      device_types: deviceType ? { [equipmentId]: deviceType } : {},
    });
    return exportResult;
  }, [equipmentId, ports, deviceType]);

  const showFailure = useCallback((caught: unknown) => {
    setMessageTone('danger');
    setMessage(caught instanceof Error ? caught.message : 'Could not build this export.');
  }, []);

  const download = async () => {
    try {
      setBusy(true);
      setMessage('');
      const exportResult = await exportPayload();
      if (exportResult.devices.length === 0) {
        const skipped = exportResult.skipped.find((item) => item.id === equipmentId);
        setMessageTone('danger');
        setMessage(skipped ? skipped.reason : 'Nothing was exported.');
        return;
      }
      const body = JSON.stringify(exportResult.devices, null, 2);
      const blob = new Blob([body], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'audiobiblica-devices.json';
      anchor.click();
      URL.revokeObjectURL(url);
      if (exportResult.warnings.length) {
        setMessageTone('success');
        setMessage(`Saved. ${exportResult.warnings.join(' ')}`);
        return;
      }
      setMessageTone('success');
      setMessage('Saved — open EasySchematic and import this file (Devices → Import).');
    } catch (caught) {
      showFailure(caught);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      setBusy(true);
      setMessage('');
      const exportResult = await exportPayload();
      if (exportResult.devices.length === 0) {
        const skipped = exportResult.skipped.find((item) => item.id === equipmentId);
        setMessageTone('danger');
        setMessage(skipped ? skipped.reason : 'Nothing was exported.');
        return;
      }
      await navigator.clipboard.writeText(JSON.stringify(exportResult.devices, null, 2));
      setMessageTone('success');
      setMessage(
        exportResult.warnings.length
          ? `Copied. ${exportResult.warnings.join(' ')}`
          : 'Copied — paste it into EasySchematic’s device import.',
      );
    } catch (caught) {
      showFailure(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="es-send" style={{ marginBlockStart: 24 }} aria-labelledby="es-send-heading">
      <h3 id="es-send-heading" style={{ fontSize: '0.8rem', marginBlockEnd: 10, color: 'var(--text-soft)' }}>Send to EasySchematic</h3>
      {advice && <p className="field-help" style={{ marginBlockEnd: 10 }}>{advice}</p>}
      {esUrl && (
        <a href={esUrl} target="_blank" rel="noreferrer" className="es-open-link" style={{ fontSize: '0.7rem', color: 'var(--teal)' }}>
          Open EasySchematic <Icon name="arrow-up-right" size={11} />
        </a>
      )}
      {suggestion && (
        <>
          <label className="form-field" style={{ marginBlockStart: 10 }}>
            <span>What kind of device is this in the drawing?</span>
            <select value={deviceType} onChange={(event) => void chooseKind(event.target.value)} aria-label="Device kind">
              <option value="">Pick a device kind…</option>
              {groupByCategory(suggestion.vocabulary).map((group) => (
                <optgroup key={group.category} label={group.category}>
                  {group.kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

          <div style={{ marginBlockStart: 12 }}>
            <div className="es-port-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBlockEnd: 6 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Ports ({ports.length})</span>
              <Button variant="ghost" size="sm" icon="plus" disabled={busy} onClick={() => { setPortsTouched(true); setPorts((current) => [...current, blankPort()]); }}>Add port</Button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ports.map((port, index) => (
                <div key={index} className="es-port-row">
                  <label className="form-field"><span className="sr-only">Port label</span>
                    <input value={port.label} maxLength={200} placeholder="Name, e.g. Mic In 1"
                      onChange={(event) => setPort(index, { label: event.target.value })} aria-label={`Port ${index + 1} label`} />
                  </label>
                  <label className="form-field"><span className="sr-only">Connector</span>
                    <select value={port.connectorType} onChange={(event) => setPort(index, { connectorType: event.target.value })} aria-label={`Port ${index + 1} connector`}>
                      {suggestion.vocabulary.connectors.map((slug) => (
                        <option key={slug} value={slug}>
                          {suggestion.vocabulary.connector_labels[slug] ?? slug.replace('-', ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field"><span className="sr-only">Signal</span>
                    <select value={port.signalType} onChange={(event) => setPort(index, { signalType: event.target.value })} aria-label={`Port ${index + 1} signal`}>
                      {suggestion.vocabulary.signals.map((signal) => <option key={signal} value={signal}>{signal}</option>)}
                    </select>
                  </label>
                  <label className="form-field"><span className="sr-only">Direction</span>
                    <select value={port.direction} onChange={(event) => setPort(index, { direction: event.target.value })} aria-label={`Port ${index + 1} direction`}>
                      {suggestion.vocabulary.directions.map((direction) => <option key={direction} value={direction}>{direction}</option>)}
                    </select>
                  </label>
                  <Button variant="ghost" size="sm" icon="x" aria-label={`Remove port ${index + 1}`} disabled={busy} onClick={() => { setPortsTouched(true); setPorts((current) => current.filter((_, i) => i !== index)); }} />
                </div>
              ))}
            </div>
            <p className="field-help" style={{ marginBlockStart: 8 }}>
              Draw the sockets this device really has. EasySchematic's own agent bridge cannot set ports (its Beta says so);
              the file can, which is why the file is the way in.
            </p>
          </div>

          <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBlockStart: 12 }}>
            <Button variant="primary" size="sm" icon="download" disabled={busy} onClick={() => void download()}>Download file</Button>
            <Button variant="secondary" size="sm" icon="copy" disabled={busy} onClick={() => void copy()}>Copy JSON</Button>
          </div>
        </>
      )}
      {message && <InlineNotice tone={messageTone} icon={messageTone === 'success' ? 'check' : 'x'}>{message}</InlineNotice>}
    </section>
  );
};

export default SendToEasySchematic;