import { ResearchRun, ResearchStepState } from './api';

/* Watching a run as it happens.
 *
 * Server-sent events rather than a poll: a tree that grows should grow when the work happens, not
 * up to a second and a half later. The server sends the current state first, so a client that
 * subscribes late still receives the whole plan.
 *
 * Falls back to nothing at all if the browser cannot stream — the caller keeps its polling loop, so
 * a stream that fails is an event stream that simply did not help rather than a run that appears
 * stuck. */

export interface RunStreamEvent {
  type: 'run' | 'step' | 'finished';
  run?: ResearchRun;
  step_id?: string;
  state?: ResearchStepState['state'];
  detail?: string | null;
  error?: string | null;
  evidence?: ResearchStepState['evidence'];
}

/** Watch a run. Returns the function that stops watching. */
export function streamResearchRun(
  runId: string,
  onEvent: (event: RunStreamEvent) => void,
  onClosed: () => void,
): () => void {
  if (typeof EventSource === 'undefined') {
    onClosed();
    return () => undefined;
  }
  const source = new EventSource(`/api/v1/research/runs/${encodeURIComponent(runId)}/stream`);
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    source.close();
  };

  source.onmessage = (message) => {
    let event: RunStreamEvent;
    try {
      event = JSON.parse(message.data) as RunStreamEvent;
    } catch {
      return; // a frame we cannot read is one frame, not the end of the run
    }
    onEvent(event);
    if (event.type === 'finished') {
      stop();
      onClosed();
    }
  };
  /* A dropped stream is not a failure: the caller's poll picks the run back up. */
  source.onerror = () => {
    stop();
    onClosed();
  };

  return stop;
}
