import React from 'react';
import { useUpdateRunner } from '../lib/useUpdate';
import { Button, InlineNotice } from '../components/ui';

/* A new version, offered where someone will actually notice it: the first screen.
   It stays out of the way otherwise — nothing renders unless there is a newer
   release *and* this installation is allowed to install it (an install pinned to a
   version, or one running from source without the updater, is not). Those cases are
   explained in Settings → Check my setup instead, where there is room for the why. */
const UpdateNotice: React.FC<{ currentVersion?: string; onToast?: (message: string, type?: 'success' | 'error') => void }> = ({ currentVersion, onToast }) => {
  const updater = useUpdateRunner({ currentVersion, onMessage: onToast });
  const status = updater.status;

  if (!status) return null;

  if (updater.updating || status.updater.in_progress) {
    return (
      <InlineNotice tone="info" icon="download">
        Updating AudioBiblica
        {status.latest ? ` to ${status.latest}` : ''} — the app is downloading the new version and
        restarting itself. This page reloads by itself when the new version answers.
      </InlineNotice>
    );
  }

  if (status.updater.failed) {
    return (
      <InlineNotice tone="danger" icon="x">
        {status.updater.message || 'The last update did not finish.'} AudioBiblica is still running
        version {status.current}. Run ./scripts/audiobiblica to try again, or open Settings → Check my setup.
      </InlineNotice>
    );
  }

  if (!status.update_available || !status.can_update) return null;

  return (
    <InlineNotice tone="warning" icon="download">
      Version {status.latest} is available (you are running {status.current}).
      <span style={{ marginInlineStart: 10 }}>
        <Button size="sm" variant="primary" icon="download" disabled={updater.refreshing} onClick={() => void updater.request()}>
          Update now
        </Button>
      </span>
    </InlineNotice>
  );
};

export default UpdateNotice;
