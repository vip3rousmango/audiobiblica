import { useCallback, useEffect, useRef, useState } from 'react';
import { getUpdateStatus, startUpdate, UpdateStatus } from './api';

/* One place that knows how to ask for an update and wait for it to land.
   Two screens offer the button — the Overview notice and the health report — and
   both have to cope with the same awkward moment: the app they are talking to is
   replaced mid-conversation, so requests fail until the new one answers.

   The waiting is an interval rather than a sleep loop, so there is nothing to
   await and nothing to cancel by hand: the interval exists exactly while an
   update is in flight. */

/** Give up after this long and tell the user to look again. */
const PATIENCE_MS = 5 * 60 * 1000;
const POLL_MS = 2000;

export interface UpdateRunner {
  status: UpdateStatus | null;
  /** True while the update is being downloaded and the app is restarting. */
  updating: boolean;
  refreshing: boolean;
  request: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
}

export function useUpdateRunner(options: {
  /** The version this page was loaded from. A different one means the swap landed. */
  currentVersion?: string;
  onMessage?: (message: string, type?: 'success' | 'error') => void;
}): UpdateRunner {
  const { currentVersion, onMessage } = options;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deadline, setDeadline] = useState(0);

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      setStatus(await getUpdateStatus(force));
    } catch {
      // Offline, or the container is mid-restart: keep the last known status.
    } finally {
      setRefreshing(false);
    }
  }, []);

  const request = useCallback(async () => {
    try {
      const requested = await startUpdate();
      onMessage?.(`Updating to ${requested.target ?? 'the newest version'}. AudioBiblica restarts itself in a moment.`);
      setDeadline(Date.now() + PATIENCE_MS);
      setUpdating(true);
    } catch (caught) {
      onMessage?.(caught instanceof Error ? caught.message : 'The update could not be started.', 'error');
    }
  }, [onMessage]);

  useEffect(() => {
    if (!updating) return;
    let stopped = false;
    const finish = (message: string, type: 'success' | 'error') => {
      if (stopped) return;
      stopped = true;
      setUpdating(false);
      onMessage?.(message, type);
    };
    const poll = async () => {
      if (Date.now() > deadline) {
        finish('The update is taking longer than expected. Reload this page in a minute.', 'error');
        return;
      }
      try {
        const latest = await getUpdateStatus();
        if (stopped) return;
        setStatus(latest);
        if (latest.updater.failed) {
          finish(latest.updater.message || 'The update did not finish.', 'error');
          return;
        }
        if (currentVersion && latest.current !== currentVersion) {
          window.location.reload();
          return;
        }
        if (!latest.updater.in_progress && latest.updater.state === 'done' && !latest.update_available) {
          finish(`AudioBiblica is now running ${latest.current}.`, 'success');
        }
      } catch {
        // The old app is gone and the new one is not answering yet. Keep waiting.
      }
    };
    const timer = window.setInterval(() => { void poll(); }, POLL_MS);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [updating, deadline, currentVersion, onMessage]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void refresh();
  }, [refresh]);

  return { status, updating, refreshing, request, refresh };
}
