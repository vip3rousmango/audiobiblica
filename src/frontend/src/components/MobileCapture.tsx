import React, { useCallback, useEffect, useState } from 'react';
import { getMobileStatus, MobileStatus, pullModel, regenerateMobileToken } from '../lib/api';
import { Button, InlineNotice, StatusDot } from './ui';

/* Pairing a phone with the catalog.
 *
 * Two things have to be true for the capture page to work, and this panel is
 * where both are visible: the app has to be reachable on the local network, and
 * a vision model has to be installed to read the photos. The QR code carries
 * the pairing token, so it is also the one place the token is shown. */

interface MobileCaptureProps {
  onToast: (message: string, type?: 'success' | 'error') => void;
}

const MobileCapture: React.FC<MobileCaptureProps> = ({ onToast }) => {
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrVersion, setQrVersion] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      setStatus(await getMobileStatus());
      setError(null);
      /* The QR image is cached by the browser; a new token means a new image. */
      setQrVersion(Date.now());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not check the pairing status.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* A download runs in the background on the server, so the panel watches for
     the reader appearing rather than holding one long request open. */
  useEffect(() => {
    if (!status || status.vision.installed || busy) return;
    const timer = window.setInterval(() => {
      void getMobileStatus().then(setStatus).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [status, busy]);

  const rotate = async () => {
    setBusy(true);
    try {
      await regenerateMobileToken();
      await refresh();
      onToast('A new link was made. Phones paired with the old one must scan again.');
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : 'Could not make a new link.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!status) return;
    setBusy(true);
    try {
      await pullModel(status.vision.model);
      onToast(`Downloading ${status.vision.model}. This can take a few minutes.`);
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : 'The download could not start.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!status?.url) return;
    try {
      await navigator.clipboard.writeText(status.url);
      onToast('Pairing link copied.');
    } catch {
      onToast('Select the link and copy it by hand.', 'error');
    }
  };

  if (error) {
    return (
      <section className="settings-section" aria-labelledby="mobile-heading">
        <div className="settings-section-header"><div><h2 id="mobile-heading">Mobile capture</h2><p>Add gear from a phone’s photos.</p></div></div>
        <InlineNotice tone="danger">{error}</InlineNotice>
      </section>
    );
  }

  /* Two reasons there may be nothing to scan: no network at all, or a container
     that cannot see the machine's address. Both are said plainly instead of
     showing a code that cannot work. */
  const hasNetwork = Boolean(status && status.address !== null);
  const addressIsUsable = !(status?.in_container && status.address_source === 'guessed');
  const canPair = hasNetwork && addressIsUsable;

  return (
    <section className="settings-section" aria-labelledby="mobile-heading">
      <div className="settings-section-header">
        <div>
          <h2 id="mobile-heading">Mobile capture</h2>
          <p>Photograph a device with your phone and it lands in the catalog, marked for review.</p>
        </div>
      </div>

      <div className="mobile-panel">
        {canPair && (
          <InlineNotice tone="info">
            Anyone on this wifi who has the link below can open the capture page and add gear to your
            catalog. Make a new link if that ever needs to stop.
          </InlineNotice>
        )}

        {!hasNetwork ? (
          <InlineNotice tone="warning">
            This computer is not on a network, so a phone has nothing to connect to. Join a wifi
            network and open this page again.
          </InlineNotice>
        ) : !addressIsUsable ? (
          /* A container cannot see the machine's address on your network, so the
             only honest thing to show is the reason and the fix — not a code
             that sends the phone to an address inside Docker. */
          <InlineNotice tone="warning">
            This copy of AudioBiblica runs in Docker, which cannot see your computer's address on
            the network, so there is no code to scan yet. Run <code>./scripts/audiobiblica</code> on
            this computer — it fills the address in for you — or set{' '}
            <code>AUDIOBIBLICA_LAN_ADDRESS</code> next to the app, then reload this page.
          </InlineNotice>
        ) : (
          <div className="mobile-qr">
            <img
              src={`/api/v1/mobile/qr.svg?v=${qrVersion}`}
              alt="QR code that opens the capture page on a phone"
              width={220}
              height={220}
            />
            <div className="mobile-qr-copy">
              <p className="field-help">
                Scan this with your phone’s camera, or open the link. Both phones and computers have
                to be on the same wifi.
              </p>
              {status?.url && <p className="mobile-url">{status.url}</p>}
              <div className="form-actions" style={{ marginBlockStart: 0 }}>
                <Button size="sm" variant="secondary" icon="copy" onClick={() => void copyLink()}>Copy link</Button>
                <Button size="sm" variant="secondary" icon="refresh" disabled={busy} onClick={() => void refresh()}>Refresh</Button>
                <Button size="sm" variant="ghost" icon="refresh" disabled={busy} onClick={() => void rotate()}>New link</Button>
              </div>
            </div>
          </div>
        )}

        <div className="mobile-reader">
          <StatusDot
            tone={status?.vision.installed ? 'success' : 'warning'}
            label={status?.vision.installed ? 'Photo reader ready' : 'Photo reader missing'}
          />
          <span className="field-help">
            Photos are read by {status?.vision.model ?? 'a local vision model'} on this computer.
            Nothing is uploaded anywhere.
          </span>
          {status && !status.vision.installed && (
            <Button size="sm" variant="primary" icon="download" disabled={busy} onClick={() => void download()}>
              Download {status.vision.model}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
};

export default MobileCapture;
