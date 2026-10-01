import React, { useCallback, useEffect, useState } from 'react';
import { getServiceInfo, ServiceInfo as ServiceInfoPayload } from '../lib/api';
import { Icon } from './Icon';
import { Button, InlineNotice, StatusDot, Surface } from './ui';

/* Where everything is, and what is running.
 *
 * Three questions this answers, all of them asked in the first week: which address do I open on my
 * phone, where did my manuals go, and is the assistant actually talking to anything. It is also the
 * first three things support always asks for, in one screen with copy buttons. */

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  running: 'success',
  served: 'success',
  ready: 'success',
  found: 'success',
  'api-only': 'neutral',
  limited: 'warning',
  'not-ready': 'warning',
  missing: 'warning',
  'not-found': 'neutral',
  absent: 'warning',
};

interface ServiceInfoProps {
  onToast: (message: string, type?: 'success' | 'error') => void;
}

const ServiceInfo: React.FC<ServiceInfoProps> = ({ onToast }) => {
  const [info, setInfo] = useState<ServiceInfoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setInfo(await getServiceInfo());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read the service information.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onToast(`${what} copied.`);
    } catch {
      onToast('Select the text and copy it by hand.', 'error');
    }
  };

  if (error) {
    return (
      <section className="settings-section" aria-labelledby="service-heading">
        <div className="settings-section-header"><div><h2 id="service-heading">Service information</h2></div></div>
        <InlineNotice tone="danger">{error}</InlineNotice>
      </section>
    );
  }

  if (!info) {
    return (
      <section className="settings-section" aria-labelledby="service-heading">
        <div className="settings-section-header"><div><h2 id="service-heading">Service information</h2></div></div>
        <p className="field-help">Reading…</p>
      </section>
    );
  }

  const rows: Array<[string, string | null]> = [
    ['Data folder', info.paths.data_dir],
    ['Catalog file', info.paths.database_path],
    ['Manual PDFs', info.paths.manuals_dir],
    ['Photos', info.paths.photos_dir],
    ['Backups', info.paths.backups_dir],
    ['Log', info.paths.log_path],
    ['Interface files', info.paths.interface_dir],
  ];

  return (
    <section className="settings-section" aria-labelledby="service-heading">
      <div className="settings-section-header">
        <div>
          <h2 id="service-heading">Service information</h2>
          <p>What is running, where your files are, and the addresses to reach this catalog from.</p>
        </div>
        <Button size="sm" variant="secondary" icon="refresh" disabled={busy} onClick={() => void refresh()}>
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      </div>

      <Surface className="service-block">
        <div className="surface-header">
          <div className="surface-title">
            <Icon name="activity" size={16} />
            <div><h3>Running now</h3><p>{info.app.version} · Python {info.app.python}{info.app.running_in_container ? ' · in a container' : ''}</p></div>
          </div>
        </div>
        <div className="surface-body">
          <div className="service-list">
            {info.services.map((service) => (
              <div className="service-row" key={service.id}>
                <StatusDot tone={TONE[service.status] ?? 'neutral'} label={service.status.replace('-', ' ')} />
                <strong>{service.label}</strong>
                <span className="service-detail">{service.detail}</span>
                {service.url && (
                  <a className="service-url" href={service.url} target="_blank" rel="noreferrer">{service.url}</a>
                )}
              </div>
            ))}
          </div>
        </div>
      </Surface>

      <Surface className="service-block">
        <div className="surface-header">
          <div className="surface-title">
            <Icon name="globe" size={16} />
            <div><h3>Addresses</h3><p>How to open this catalog, here and from a phone on the same wifi.</p></div>
          </div>
        </div>
        <div className="surface-body">
          <div className="service-list">
            <div className="service-row">
              <strong>On this computer</strong>
              <span className="service-url">{info.network.open_here}</span>
              <Button size="sm" variant="ghost" icon="copy" onClick={() => void copy(info.network.open_here, 'Address')}>Copy</Button>
            </div>
            <div className="service-row">
              <strong>From your phone</strong>
              {info.network.capture_url ? (
                <>
                  <span className="service-url">{info.network.capture_url.split('?')[0]}</span>
                  <Button size="sm" variant="ghost" icon="copy" onClick={() => void copy(info.network.capture_url as string, 'Pairing link')}>Copy link</Button>
                </>
              ) : (
                <span className="service-detail">
                  {info.app.running_in_container && info.network.address_source === 'guessed'
                    ? 'This computer\u2019s address is not known yet — run ./scripts/audiobiblica to fill it in.'
                    : 'This computer is not on a network.'}
                </span>
              )}
            </div>
          </div>
        </div>
      </Surface>

      <Surface className="service-block">
        <div className="surface-header">
          <div className="surface-title">
            <Icon name="database" size={16} />
            <div><h3>Your files</h3><p>Everything AudioBiblica has written, in one place.</p></div>
          </div>
        </div>
        <div className="surface-body">
          <dl className="service-paths">
            {rows.filter(([, value]) => value).map(([label, value]) => (
              <div className="service-path" key={label}>
                <dt>{label}</dt>
                <dd>
                  <span>{value}</span>
                  <Button size="sm" variant="ghost" icon="copy" onClick={() => void copy(value as string, label)}>Copy</Button>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Surface>
    </section>
  );
};

export default ServiceInfo;
